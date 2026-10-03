// Port of keiyoushi/extensions-source src/en/mangadass/MangaDass.kt
import { ClientBuilder, DateTimeFormatter, Locale, toHttpUrl } from "../../../sdk/index.ts";
import { MadaraNoAjax } from "../../../themes/madara/index.ts";

export default class MangaDass extends MadaraNoAjax {
  protected override supportsPostId = false;
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.US);

  protected override configureClient(b: ClientBuilder) {
    return b.rateLimit(3);
  }

  override getPopularManga(page: number) {
    return this.archivePage(page, "trending");
  }

  protected override archiveUrlSelector = "a";
  protected override archiveTitleSelector: string | null = "h3";
  protected override nextPageSelector() {
    return "ul.pagination li.next a";
  }

  protected override orderQueryParameter = "orderby";
  protected override searchQueryParameter = "q";
  protected override archiveUrlBuilder(page: number, order: string, path: string, query: string): URL {
    const b = toHttpUrl(super.archiveUrlBuilder(page, order, path, query).href).newBuilder();
    if (page > 1) b.removePathSegment(1);
    return b.build().toURL();
  }
  protected override searchUrlBuilder(page: number, query: string): URL {
    const b = toHttpUrl(super.searchUrlBuilder(page, query).href).newBuilder();
    if (page > 1) {
      b.removePathSegment(1);
      b.addQueryParameter("page", String(page));
    }
    b.setPathSegment(0, "search");
    return b.build().toURL();
  }

  protected override chapterListSelector() {
    return ".row-content-chapter li";
  }
  protected override chapterDateSelector = ".chapter-time";

  protected override pageListParseSelector = ".read-content img";

  protected override filterGenresSelector = "div.container";
}
