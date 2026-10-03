// Port of keiyoushi/extensions-source src/id/inazumanga/ReYume.kt
import type { Document, Page } from "../../../sdk/index.ts";
import { ZeistManga } from "../../../themes/zeistmanga/index.ts";

export default class ReYume extends ZeistManga {
  protected override popularMangaSelector = ".pop-card";
  protected override popularMangaSelectorTitle = "h4 a";
  protected override popularMangaSelectorUrl = "h4 a";

  protected override mangaDetailsSelector = "#Blog1";
  protected override mangaDetailsSelectorDescription = "#synopsis p";
  protected override mangaDetailsSelectorGenres = "#append-info .col-span-2 a[rel=tag]";
  protected override mangaDetailsSelectorAuthor = "#extra-info dl:has(dt:contains(Author)) dd";
  protected override mangaDetailsSelectorArtist = "#extra-info dl:has(dt:contains(Artist)) dd";
  protected override mangaDetailsSelectorAltName = "#extra-info dl:has(dt:contains(Alternative)) dd";
  protected override mangaDetailsSelectorStatus = "span[data-bg]";
  protected override mangaDetailsSelectorInfo = "#append-info > div";
  protected override mangaDetailsSelectorInfoTitle = "dt";
  protected override mangaDetailsSelectorInfoDescription = "dd";

  protected override pageListSelector = ".separator";

  override pageListParse(document: Document): Page[] {
    const textArea = document.selectFirst("textarea#zeist-raw-data")?.text() ?? "";
    return super.pageListParse(this.parseDocument(textArea));
  }
}
