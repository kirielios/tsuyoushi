// Port of keiyoushi/extensions-source src/id/kaguya/Kaguya.kt
import { Base64, ClientBuilder, fromUtf8, type Element } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class Kaguya extends Madara {
  protected override supportsPostId = false;
  protected override configureClient(b: ClientBuilder) {
    return b.readTimeout(60_000);
  }

  // Fixed: Set to "series" to match https://02.kaguya.pro/series/...
  protected override mangaSubString = "series";
  protected override genreDirectory = "series-genre";

  protected override mangaDetailsSelectorTitle = "h1.post-title";
  protected override mangaDetailsSelectorStatus = "div.summary-heading:contains(Status) + div";
  protected override mangaDetailsSelectorThumbnail = "head meta[property='og:image']";

  protected override imageFromElement(element: Element): string | null {
    if (element.hasAttr("data-aesir")) {
      const decoded = fromUtf8(Base64.decode(element.attr("data-aesir"))).trim();
      if (decoded) return decoded;
    }

    const url = super.imageFromElement(element);
    return url ? url : element.attr("content");
  }

  protected override chapterMode = ChapterMode.MangaAjaxPaginated;
}
