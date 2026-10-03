// Port of keiyoushi/extensions-source src/en/mangakakalot/Mangakakalot.kt
import type { ClientBuilder, SManga } from "../../../sdk/index.ts";
import { MangaBox } from "../../../themes/mangabox/index.ts";

export default class Mangakakalot extends MangaBox {
  /* ================================
   * Slug Utilities
   * ================================ */

  private readonly idSlugRegex = /^[a-z]{2}\d+$/;

  private titleToSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/[\s-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * Resolves download issues for very large chapters (~100+ pages): Mangakakalot slows down or rejects image-heavy
   * requests when connections are reused aggressively. Upstream also caps OkHttp's dispatcher (8 requests, 3 per
   * host); the host owns connections here, so only the timeouts and the rate limit carry over.
   */
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return super.configureClient(builder).connectTimeout(30_000).readTimeout(60_000).rateLimit(2, 1000);
  }

  override computeMangaSlug(manga: SManga): string {
    const it = super.computeMangaSlug(manga);
    return this.idSlugRegex.test(it) ? this.titleToSlug(manga.title) : it;
  }
}
