// Port of keiyoushi/extensions-source src/en/ragescans/RageScans.kt
import type { Document, SManga } from "../../../sdk/index.ts";
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

export default class RageScans extends MangaThemesia {
  protected override chapterListSelector() {
    return "li:has(.chbox .eph-num):not(:has([data-bs-target='#lockedChapterModal']))";
  }

  protected override mangaDetailsParse(document: Document): SManga {
    document.select("#comments").remove();
    return super.mangaDetailsParse(document);
  }
}
