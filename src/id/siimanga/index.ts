// Port of keiyoushi/extensions-source src/id/siimanga/Siikomik.kt
import type { Element, SChapter } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class Siikomik extends Madara {
  protected override mangaSubString = "komik";
  protected override chapterMode = ChapterMode.MangaAjax;

  protected override chapterFromElement(element: Element, mangaPath: string): SChapter | null {
    const chapter = super.chapterFromElement(element, mangaPath);
    if (chapter && (element.hasClass("premium") || element.hasClass("premium-block"))) {
      chapter.name = `🔒 ${chapter.name}`;
    }
    return chapter;
  }
}
