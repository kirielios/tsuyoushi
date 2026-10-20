// Port of aniyomi lib/filemoonextractor. Each source's master playlist is returned as one video: the player (hls.js)
// reads its variants and switches quality itself, so PlaylistUtils' per-variant split is not needed.
// Crypto (ECDSA P-256, AES-GCM) goes through WebCrypto.
import { Video } from "../../sdk/anime.ts";
import { Base64, concat, fromUtf8, utf8 } from "../../sdk/crypto.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { substringAfter, substringBefore } from "../../sdk/strings.ts";

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

export class FilemoonExtractor {
  constructor(private readonly client: HttpClient) {}

  // Credit: https://github.com/skoruppa/docchi-players/blob/b03fb310aba1d73c6c97ed62a7db2569a49f8d79/filemoon.py
  async videosFromUrl(url: string, prefix = "Filemoon - ", headers: Headers | null = null, referer: string | null = null): Promise<Video[]> {
    try {
      const httpUrl = new URL(url);
      const host = httpUrl.host;
      const mediaId = extractMediaId(httpUrl);
      if (!mediaId.trim()) return [];

      const userAgent = headers?.get("User-Agent") ?? DEFAULT_UA;

      const baseHeaders = new Headers(headers ?? undefined);
      baseHeaders.set("User-Agent", userAgent);
      baseHeaders.set("Accept", "*/*");
      baseHeaders.set("Accept-Language", "en-US,en;q=0.9");
      baseHeaders.set("Cache-Control", "no-cache");
      baseHeaders.set("Pragma", "no-cache");

      // Get embed URL from details endpoint to resolve the actual host
      const embedUrl = await this.getEmbedUrl(host, mediaId, baseHeaders);
      if (!embedUrl) return [];

      const embedHost = new URL(embedUrl).host;
      const pageReferer = referer ?? embedUrl;
      const origin = `https://${embedHost}`;

      const apiHeaders = new Headers(baseHeaders);
      apiHeaders.set("Referer", pageReferer);
      apiHeaders.set("Origin", origin);

      // Use only the new challenge flow
      const data = await this.challengeFlow(mediaId, apiHeaders, origin, userAgent, url);
      if (!data) return [];

      const sources = await extractSources(data);
      if (!sources?.length) return [];

      const videoHeaders = new Headers(baseHeaders);
      videoHeaders.set("Referer", origin);
      videoHeaders.delete("Origin");

      return sources.flatMap((source) => {
        const streamUrl = source.url ?? source.file;
        if (!streamUrl) return [];
        const quality = source.label === undefined ? "Default" : (source.label ?? "Unknown");
        return [new Video({ videoUrl: streamUrl, videoTitle: `${prefix}${quality}`, headers: videoHeaders })];
      });
    } catch {
      return [];
    }
  }

  private async getEmbedUrl(host: string, mediaId: string, headers: Headers): Promise<string | null> {
    const detailsUrl = `https://${host}/api/videos/${mediaId}/embed/details`;
    try {
      const body = (await this.client.get(detailsUrl, headers, { ensureSuccess: false })).text();
      const embedFrameUrl = substringBefore(substringAfter(substringAfter(substringAfter(body, "embed_frame_url", ""), ":"), '"'), '"');
      return embedFrameUrl.trim() ? embedFrameUrl : null;
    } catch {
      return null;
    }
  }

  private async postJson<T>(url: string, headers: Headers, body: unknown): Promise<T> {
    const h = new Headers(headers);
    h.set("Content-Type", "application/json; charset=utf-8");
    return (await this.client.post(url, h, JSON.stringify(body), { ensureSuccess: false })).parseAs<T>();
  }

  private async challengeFlow(mediaId: string, apiHeaders: Headers, origin: string, userAgent: string, pageUrl: string): Promise<PlaybackResponse | null> {
    try {
      // Step 1: Challenge
      const challengeData = await this.postJson<ChallengeResponse>(`${origin}/api/videos/access/challenge`, apiHeaders, {});
      const { challenge_id: challengeId, nonce } = challengeData;

      // Step 2: Attest (ECDSA sign nonce + fingerprint)
      const { privateKey, publicKeyJwk } = await generateEcKeyPair();
      const signature = await signNonce(privateKey, nonce);
      const attestData = await this.postJson<AttestResponse>(`${origin}/api/videos/access/attest`, apiHeaders, {
        viewer_id: "",
        device_id: "",
        challenge_id: challengeId,
        nonce,
        signature,
        public_key: publicKeyJwk,
        client: generateClientFingerprint(userAgent),
        storage: {},
        attributes: { entropy: "low" },
      });

      const fingerprint: FingerprintData = {
        token: attestData.token,
        viewer_id: attestData.viewer_id,
        device_id: attestData.device_id,
        confidence: attestData.confidence,
      };

      // Step 3: Captcha (get PoW challenge)
      const refererUrl = apiHeaders.get("Referer") ?? pageUrl;
      let refererHttpUrl: URL;
      try {
        refererHttpUrl = new URL(refererUrl);
      } catch {
        refererHttpUrl = new URL(pageUrl);
      }
      const refererHost = refererHttpUrl.hostname;
      const refererOrigin = `${refererHttpUrl.protocol}//${refererHost}`;

      const captchaHeaders = new Headers(apiHeaders);
      captchaHeaders.set("X-Embed-Origin", refererHost);
      captchaHeaders.set("X-Embed-Referer", `${refererOrigin}/`);
      captchaHeaders.set("X-Embed-Parent", pageUrl);
      captchaHeaders.set("Cookie", `byse_viewer_id=${fingerprint.viewer_id}; byse_device_id=${fingerprint.device_id}`);

      const captchaData = await this.postJson<CaptchaResponse>(`${origin}/api/videos/${mediaId}/embed/captcha`, captchaHeaders, { fingerprint });

      // Step 4: Solve PoW and verify
      const solution = solvePow(captchaData.pow_nonce, captchaData.pow_difficulty);
      const verifyData = await this.postJson<VerifyResponse>(`${origin}/api/videos/${mediaId}/embed/captcha/verify`, captchaHeaders, {
        pow_token: captchaData.pow_token,
        solution,
        fingerprint,
      });
      if (verifyData.status !== "ok") return null;
      const captchaToken = verifyData.token;
      if (!captchaToken?.trim()) return null;

      // Step 5: Get playback with captcha token
      const playbackHeaders = new Headers(captchaHeaders);
      playbackHeaders.set("X-Captcha-Token", captchaToken);
      return await this.postJson<PlaybackResponse>(`${origin}/api/videos/${mediaId}/embed/playback`, playbackHeaders, { fingerprint });
    } catch {
      return null;
    }
  }
}

function extractMediaId(httpUrl: URL): string {
  const segments = httpUrl.pathname.slice(1).split("/");
  const s0 = segments[0];
  if (segments.length > 1 && (s0 === "e" || s0 === "eyi" || s0 === "d" || s0 === "download" || s0.startsWith("j"))) return segments[1];
  return segments.filter((s) => s).at(-1) ?? "";
}

async function extractSources(data: PlaybackResponse): Promise<VideoSource[] | null> {
  if (data.sources?.length) return data.sources;
  if (data.playback) {
    try {
      return (JSON.parse(await decrypt(data.playback)) as PlaybackResponse).sources ?? null;
    } catch {
      // Decryption failed
    }
  }
  return null;
}

async function decrypt(input: PlaybackData): Promise<string> {
  const parts = input.key_parts;
  const v = input.version == null ? null : /^[+-]?\d+$/.test(input.version) ? Number(input.version) : 1;
  const selected = v != null && parts.length >= v ? [parts[v - 1], parts[parts.length - v]] : parts;
  const keyBytes = concat(...selected.map(decodeBase64Url));
  const ivBytes = decodeBase64Url(input.iv);
  const payloadBytes = decodeBase64Url(input.payload);
  // AES-GCM: last 16 bytes are the authentication tag (WebCrypto takes ciphertext + tag as one, like Java)
  if (payloadBytes.length < 16) return "";
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-GCM", false, ["decrypt"]);
  return fromUtf8(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes as BufferSource, tagLength: 128 }, key, payloadBytes as BufferSource)));
}

const decodeBase64Url = (input: string) => Base64.decode(input);
const encodeBase64Url = (bytes: Uint8Array) => Base64.encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// --- Crypto helpers ---

async function generateEcKeyPair(): Promise<{ privateKey: CryptoKey; publicKeyJwk: EcJwk }> {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return { privateKey: keyPair.privateKey, publicKeyJwk: { alg: "ES256", crv: "P-256", ext: true, key_ops: ["verify"], kty: "EC", x: jwk.x!, y: jwk.y! } };
}

// Upstream's SHA256withECDSA gives a DER signature; WebCrypto gives raw r||s (64 bytes), which is what the site's own
// player (WebCrypto too) sends.
async function signNonce(privateKey: CryptoKey, nonce: string): Promise<string> {
  const signed = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, utf8(nonce) as BufferSource);
  return encodeBase64Url(new Uint8Array(signed));
}

function generateClientFingerprint(userAgent: string): ClientFingerprint {
  const randHash = () => encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  return {
    user_agent: userAgent,
    pixel_ratio: 1,
    screen_width: 1920,
    screen_height: 1080,
    color_depth: 24,
    languages: ["en-US", "en"],
    timezone: "America/New_York",
    hardware_concurrency: 8,
    touch_points: 0,
    webgl_vendor: "Google Inc. (Intel)",
    webgl_renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)",
    canvas_hash: randHash(),
    audio_hash: randHash(),
    webgl_params_hash: randHash(),
    fonts_hash: randHash(),
    codecs_hash: randHash(),
    media_devices: "ai0ao0vi0",
    pointer_type: "fine,hover",
    extra: { vendor: "", appVersion: "5.0 (X11)" },
  };
}

// --- PoW Solver (Memory-hard hash from Python) --- 32-bit unsigned arithmetic: `>>> 0` for Kotlin's `and mask32`.
export function solvePow(nonce: string, difficulty: number, maxIterations = 200000): string {
  const prefix = `${nonce}:`;
  const bufferSize = 512;
  const bufferMask = 511;
  const initConst = 2654435761;
  const finalConst = 2246822519;
  const rotl = (value: number, shift: number) => ((value << shift) | (value >>> (32 - shift))) >>> 0;

  const buf = new Uint32Array(bufferSize);
  for (let counter = 0; counter <= maxIterations; counter++) {
    const input = prefix + counter; // ISO-8859-1: one byte per char
    let s0 = 1779033703;
    let s1 = 3144134277;
    let s2 = 1013904242;
    let s3 = 2773480762;
    const round = () => {
      s0 = (s0 + s1) >>> 0;
      s3 = rotl(s3 ^ s0, 16);
      s2 = (s2 + s3) >>> 0;
      s1 = rotl(s1 ^ s2, 12);
      s0 = (s0 + s1) >>> 0;
      s3 = rotl(s3 ^ s0, 8);
      s2 = (s2 + s3) >>> 0;
      s1 = rotl(s1 ^ s2, 7);
    };

    for (let i = 0; i < input.length; i++) {
      s0 = (s0 + (input.charCodeAt(i) & 0xff)) >>> 0;
      s0 = rotl(s0, 7);
      s0 = (s0 + s1) >>> 0;
      s3 = rotl(s3 ^ s0, 16);
      s2 = (s2 + s3) >>> 0;
      s1 = rotl(s1 ^ s2, 12);
      s0 = (s0 + s1) >>> 0;
      s3 = rotl(s3 ^ s0, 8);
      s2 = (s2 + s3) >>> 0;
      s1 = rotl(s1 ^ s2, 7);
    }
    for (let r = 0; r < 8; r++) round();
    for (let i = 0; i < bufferSize; i++) {
      round();
      buf[i] = s0 ^ s2;
    }
    for (let r = 0; r < 2; r++) {
      for (let si = 0; si < bufferSize; si++) {
        const a = buf[si] & bufferMask;
        let c = (buf[si] + buf[a]) >>> 0;
        c = rotl(c, 13);
        c = (c ^ Math.imul(buf[(si + 1) & bufferMask], initConst)) >>> 0;
        buf[si] = c;
        s0 = (s0 ^ c) >>> 0;
        round();
      }
    }
    round();

    let outVal = s0;
    for (let ci = 0; ci < 64; ci++) {
      const d = buf[ci];
      outVal = (outVal + d) >>> 0;
      outVal = rotl(outVal, 5);
      outVal = (outVal ^ Math.imul(d, finalConst)) >>> 0;
    }
    outVal = (outVal ^ s2) >>> 0;

    if (Math.clz32(outVal) >= difficulty) return String(counter);
  }
  throw new Error(`PoW solver: no solution found in ${maxIterations} iterations`);
}

// --- DTOs ---

interface ChallengeResponse {
  challenge_id: string;
  nonce: string;
}
interface AttestResponse {
  token: string;
  viewer_id: string;
  device_id: string;
  confidence: number;
}
interface EcJwk {
  alg: string;
  crv: string;
  ext: boolean;
  key_ops: string[];
  kty: string;
  x: string;
  y: string;
}
type ClientFingerprint = Record<string, unknown>;
interface FingerprintData {
  token: string;
  viewer_id: string;
  device_id: string;
  confidence: number;
}
interface CaptchaResponse {
  pow_nonce: string;
  pow_difficulty: number;
  pow_token: string;
}
interface VerifyResponse {
  status: string;
  token?: string | null;
}
interface PlaybackResponse {
  sources?: VideoSource[] | null;
  playback?: PlaybackData | null;
}
interface PlaybackData {
  iv: string;
  key_parts: string[];
  payload: string;
  version?: string | null;
}
interface VideoSource {
  file?: string | null;
  url?: string | null;
  label?: string | null;
}
