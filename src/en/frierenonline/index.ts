// Port of keiyoushi/extensions-source src/en/frierenonline/FrierenOnline.kt
import { FilterList, toHttpUrl, type SChapter } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madara/index.ts";

export default class FrierenOnline extends Madara {
  override get supportsLatest() {
    return false;
  }
  override get supportsFilterFetching() {
    return false;
  }
  override get supportsRelatedMangas() {
    return false;
  }

  override getFilterList(_data: unknown = null) {
    return FilterList();
  }

  protected override mangaDetailsSelectorTitle = ".about h1";
  protected override mangaDetailsSelectorAuthor = "h5:contains(Author) + h4";
  protected override mangaDetailsSelectorArtist = "h5:contains(Artist) + h4";
  protected override mangaDetailsSelectorStatus = "h5:contains(Status) + h4";
  protected override mangaDetailsSelectorDescription = ".synopsis";
  protected override mangaDetailsSelectorThumbnail = ".cover_managa img";
  protected override mangaDetailsSelectorGenre = ".tags a[rel=tag]";

  protected override chapterListSelector() {
    return "li.m-chapter";
  }
  protected override chapterUrlSelector = "a:has(.chapter-content)";

  // Prepend /manga since mangaPath becomes / due to redirection
  override getChapterUrl(chapter: SChapter) {
    const it = toHttpUrl(super.getChapterUrl(chapter));
    return it.newBuilder().encodedPath(`/manga${it.encodedPath}`).build().toString();
  }
}
