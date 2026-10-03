// Port of keiyoushi/extensions-source src/en/asmotoon/Asmotoon.kt
import { toHttpUrl, type ClientBuilder, type SManga } from "../../../sdk/index.ts";
import { Keyoapp } from "../../../themes/keyoapp/index.ts";

const OLD_CHAPTER_SLUG_REGEX = /(?<=\/series\/)[0-9a-f]{11}(?=\/)/g;

export default class Asmotoon extends Keyoapp {
  private get baseUrlHost() {
    return toHttpUrl(this.baseUrl).host;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(3, 5_000, (it) => it.hostname === this.baseUrlHost);
  }

  override popularMangaSelector() {
    return "div:contains(Trending) + div .group";
  }
  override latestUpdatesSelector() {
    return ".group";
  }
  override searchMangaSelector() {
    return this.latestUpdatesSelector();
  }

  protected override genreSelector = ".gap-3 .gap-1 a";

  private titleToSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/[\s-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private fix(manga: SManga): SManga {
    manga.url = manga.url.replace(OLD_CHAPTER_SLUG_REGEX, () => this.titleToSlug(manga.title));
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    return super.getMangaUrl(this.fix(manga));
  }
}
