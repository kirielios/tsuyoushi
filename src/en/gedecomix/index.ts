// Port of keiyoushi/extensions-source src/en/gedecomix/GEDEComix.kt
import type { Element, SManga } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class GEDEComix extends Madara {
  // "${super.mangaDetailsSelectorThumbnail}:not([data-eio])"; class fields cannot read super's
  protected override mangaDetailsSelectorThumbnail = "div.summary_image img:not([data-eio])";
  protected override mangaSubString = "porncomic";
  protected override chapterMode = ChapterMode.MangaAjax;

  protected override archiveManga(element: Element, id: string): SManga | null {
    const manga = super.archiveManga(element, id);
    if (manga) {
      const it = element.selectFirst("img:not([data-eio])");
      if (it) manga.thumbnail_url = this.imageFromElement(it) ?? undefined;
    }
    return manga;
  }
}
