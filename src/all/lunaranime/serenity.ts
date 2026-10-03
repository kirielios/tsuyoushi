// Port of keiyoushi/extensions-source src/all/lunaranime/LunarSerenity.kt
import { Base64, utf8, type Chain, type ChainInterceptor, type Request, type Response } from "../../../sdk/index.ts";

const PROOF_HEADER = "cant-catch-this-monkey";

const base64Url = (b: Uint8Array) => Base64.encode(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * The site's "Serenity" proof is a plain DPoP JWT. The browser generates its own P-256 key pair, keeps it in IndexedDB
 * and signs `<header>.<payload>` with ES256, sending the result in the `cant-catch-this-monkey` header. The key pair is
 * never issued or acknowledged by the server, so one generated here is just as valid.
 *
 * WebCrypto replaces the JCA: an exported JWK already carries the fixed-width base64url coordinates, and ECDSA signs
 * straight into JOSE's raw `r || s`, so toFixedWidth/derToJose are not needed.
 */
export class LunarSerenity {
  private keyPair: Promise<{ pair: CryptoKeyPair; x: string; y: string }> = LunarSerenity.generateKeyPair();

  constructor(private readonly apiUrl: string) {}

  private static async generateKeyPair() {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    return { pair, x: jwk.x!, y: jwk.y! };
  }

  reset() {
    this.keyPair = LunarSerenity.generateKeyPair();
  }

  /** RFC 7638 thumbprint of the public JWK, used by the site as extra key material when decrypting a chapter's session data. */
  async thumbprint(): Promise<string> {
    const { x, y } = await this.keyPair;
    const jwk = `{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`;
    return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(jwk) as BufferSource)));
  }

  async proof(method: string, url: string): Promise<string> {
    const { pair, x, y } = await this.keyPair;
    const u = new URL(url);
    const header = `{"alg":"ES256","typ":"dpop+jwt","jwk":{"kty":"EC","crv":"P-256","x":"${x}","y":"${y}"}}`;
    const payload = `{"htu":"${u.protocol}//${u.hostname}${u.pathname}","htm":"${method.toUpperCase()}","iat":${Math.floor(Date.now() / 1000)},"jti":"${crypto.randomUUID()}"}`;

    const signingInput = `${base64Url(utf8(header))}.${base64Url(utf8(payload))}`;
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, utf8(signingInput) as BufferSource));
    return `${signingInput}.${base64Url(signature)}`;
  }

  interceptor(): ChainInterceptor {
    return async (chain: Chain): Promise<Response> => {
      const request = chain.request();
      if (!request.url.startsWith(this.apiUrl)) return chain.proceed(request);

      const response = await chain.proceed(await this.withProof(request));

      // The site mints a fresh key pair whenever the server rejects the current one.
      if (response.code === 403 && /validate/i.test(new TextDecoder().decode(response.bytes().subarray(0, 1024)))) {
        this.reset();
        return chain.proceed(await this.withProof(request));
      }
      return response;
    };
  }

  private async withProof(request: Request): Promise<Request> {
    const headers = new Headers(request.headers);
    headers.set(PROOF_HEADER, await this.proof(request.method, request.url));
    return { ...request, headers };
  }
}
