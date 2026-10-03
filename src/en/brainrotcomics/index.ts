// Port of keiyoushi/extensions-source src/en/brainrotcomics/BrainRotComics.kt
import type { Document, SManga } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class BrainRotComics extends Madara {
  protected override chapterMode = ChapterMode.MangaAjax;
  protected override altNameSelector = "noSelector";

  protected override parseDetails(document: Document, id: string, preserveUrl: string | null): SManga {
    const manga = super.parseDetails(document, id, preserveUrl);
    manga.author = undefined;
    manga.artist = undefined;
    return manga;
  }
}
