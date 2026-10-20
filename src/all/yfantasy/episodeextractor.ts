// Port of yuzono/anime-extensions src/all/yfantasy/EpisodeExtractor.kt
import { HttpException, type HttpClient } from "../../../sdk/index.ts";
import type { AnimeDto, AuthDto } from "./dto.ts";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MILLIS = 1000;

/**
 * Recovers the segment list of a video, by walking the guest unlock flow of the site: register a throwaway anonymous
 * account, claim the free first hidden segment, spend the starting coin balance on the next one, then read the
 * session, which answers with the same shape as the catalog entries.
 */
export class EpisodeExtractor {
  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
    private readonly baseUrl: string,
  ) {}

  async getAnime(videoId: string): Promise<AnimeDto | null> {
    try {
      return await this.getSession(videoId, await this.unlockedHeaders(videoId));
    } catch (e) {
      console.error(`YFantasy: could not extract the segments of ${videoId}`, e);
      return null;
    }
  }

  /**
   * Guest headers holding the two unlocked segments, or the plain source headers when the unlock flow fails: the
   * session lists every segment either way, the unlocked ones just come with a playable url.
   */
  private async unlockedHeaders(videoId: string): Promise<Headers> {
    try {
      const authHeaders = new Headers(this.headers);
      authHeaders.set("Authorization", `Bearer ${await this.authenticate()}`);
      await this.claimFirstSegment(videoId, authHeaders).catch(() => undefined);
      await this.continueToNextSegment(videoId, authHeaders).catch(() => undefined);
      return authHeaders;
    } catch (e) {
      console.warn(`YFantasy: could not unlock the segments of ${videoId}, listing them locked`, e);
      return this.headers;
    }
  }

  private json(headers: Headers): Headers {
    const h = new Headers(headers);
    h.set("Content-Type", "application/json");
    return h;
  }

  private async authenticate(): Promise<string> {
    const body = JSON.stringify({ token: crypto.randomUUID() });
    return (await retry(async () => (await this.client.post(`${this.baseUrl}/api/auth/anonymous`, this.json(this.headers), body)).parseAs<AuthDto>())).sessionToken;
  }

  /** Only the first hidden segment is claimable, any other one is rejected. */
  private async claimFirstSegment(videoId: string, authHeaders: Headers) {
    await this.client.post(`${this.baseUrl}/api/me/guest-first-unlocks/claim`, this.json(authHeaders), JSON.stringify({ videoId, segmentId: `${videoId}_segment_1` }));
  }

  /** Answers 402 once the coin balance no longer covers the next segment. */
  private async continueToNextSegment(videoId: string, authHeaders: Headers) {
    await this.client.post(`${this.baseUrl}/api/videos/${videoId}/continue`, authHeaders, "");
  }

  private async getSession(videoId: string, authHeaders: Headers): Promise<AnimeDto> {
    return retry(async () => (await this.client.get(`${this.baseUrl}/api/videos/${videoId}/session?language=en`, authHeaders)).parseAs<AnimeDto>());
  }
}

/**
 * The account and session calls fail transiently often enough to be worth retrying, while a client error is a
 * permanent rejection that no retry can turn around.
 */
async function retry<T>(block: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS - 1; attempt++) {
    try {
      return await block();
    } catch (e) {
      if (e instanceof HttpException && e.code >= 400 && e.code <= 499) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MILLIS << attempt));
    }
  }
  return block();
}
