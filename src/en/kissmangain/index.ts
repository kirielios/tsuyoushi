// Port of keiyoushi/extensions-source src/en/kissmangain/KissmangaIn.kt
import type { Element } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class KissmangaIn extends Madara {
  protected override mangaSubString = "kissmanga";

  protected override chapterMode = ChapterMode.MangaAjax;

  protected override imageFromElement(element: Element): string | null {
    return super.imageFromElement(element)?.trim() ?? null;
  }
}
