// Port of keiyoushi/extensions-source src/all/manhwa18cc/Manhwa18Cc.kt
import { DateTimeFormatter, Locale, toHttpUrl, type HttpUrlBuilder } from "../../../sdk/index.ts";
import { MadaraNoAjax } from "../../../themes/madara/index.ts";

/** Upstream edits the HttpUrl.Builder the theme returns; here the theme returns a URL, so round-trip through one. */
const editUrl = (url: URL, edit: (b: HttpUrlBuilder) => void) => {
  const b = toHttpUrl(url.href).newBuilder();
  edit(b);
  return b.build().toURL();
};

export default class Manhwa18Cc extends MadaraNoAjax {
  protected override supportsPostId = false;
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.US);

  protected override mangaSubString = this.lang === "ko" ? "raw" : "webtoons";

  protected override archiveSelector() {
    switch (this.lang) {
      case "en":
        return "div.manga-item:not(:has(h3 a[title$='Raw']))";
      case "ko":
        return "div.manga-item:has(h3 a[title$='Raw'])";
      default:
        return "div.manga-item";
    }
  }

  protected override archiveUrlSelector = "div.manga-item div.data a";

  override getPopularManga(page: number) {
    return this.archivePage(page, "trending");
  }
  override getLatestUpdates(page: number) {
    return this.archivePage(page, "");
  }

  protected override nextPageSelector() {
    return "ul.pagination li.next a";
  }

  protected override orderQueryParameter = "orderby";
  protected override searchQueryParameter = "q";
  protected override archiveUrlBuilder(page: number, order: string, path: string, query: string): URL {
    return editUrl(super.archiveUrlBuilder(page, order, path, query), (b) => {
      if (page > 1) b.removePathSegment(1);
    });
  }
  protected override searchUrlBuilder(page: number, query: string): URL {
    return editUrl(super.searchUrlBuilder(page, query), (b) => {
      if (page > 1) {
        b.removePathSegment(1);
        b.addQueryParameter("page", String(page));
      }
      b.setPathSegment(0, "search");
    });
  }

  protected override mangaDetailsSelectorDescription = "div.panel-story-description div.dsct";

  protected override chapterListSelector() {
    return "li.a-h";
  }

  protected override chapterDateSelector = "span.chapter-time";

  protected override pageListParseSelector = "div.read-content img";

  protected override filterGenresSelector = ".header-bottom";
  protected override genreDirectory = "webtoon-genre";
}
