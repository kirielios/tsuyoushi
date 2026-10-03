// Port of keiyoushi/extensions-source src/en/yakshacomics/YakshaComics.kt
import { ClientBuilder, toHex, type Chain, type Request, type Response } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madara/index.ts";

const MAX_ATTEMPT = 5;
const TOKEN_REGEX = /cjs[^']+'([^']+)/;

export default class YakshaComics extends Madara {
  // Adapted from src/en/yakshascans
  protected override configureClient(b: ClientBuilder) {
    b.addChainInterceptor((chain) => this.jsChallengeInterceptor(chain));
    b.rateLimit(1);
    return b;
  }
  private async jsChallengeInterceptor(chain: Chain): Promise<Response> {
    const response = await chain.proceed(chain.request());
    if (response.code !== 403) {
      return response;
    }

    await new Promise((r) => setTimeout(r, 3000));
    const token = await sha256(await this.fetchToken(chain));
    const body = new URLSearchParams({ challenge: token }).toString();

    const headers = this.headers;
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    const validateResponse = await chain.proceed(this.request("POST", `${this.baseUrl}/hcdn-cgi/jschallenge-validate`, headers, body));
    if (!validateResponse.isSuccessful) {
      throw new Error("Failed to bypass js challenge!");
    }
    return chain.proceed(chain.request());
  }

  private async fetchToken(chain: Chain, attempt = 0): Promise<string> {
    if (attempt > MAX_ATTEMPT) {
      throw new Error("Failed to fetch challenge token!");
    }

    const response = await chain.proceed(this.request("GET", `${this.baseUrl}/hcdn-cgi/jschallenge`, this.headers));
    const token = TOKEN_REGEX.exec(response.text())?.[1];

    return token && token !== "nil" ? token : this.fetchToken(chain, attempt + 1);
  }

  private request(method: string, url: string, headers: Headers, body?: string): Request {
    return { method, url, headers, body };
  }
}

async function sha256(s: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}
