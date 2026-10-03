// Port of keiyoushi/extensions-source src/all/manhwaclubnet/ManhwaClubNet.kt
import type { Document, SChapter } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class ManhwaClubNet extends Madara {
  protected override chapterMode = ChapterMode.AdminAjax;

  protected override async fetchChapters(mangaPath: string, id: string, mangaPage: Document | null = null): Promise<SChapter[]> {
    const chapters = await super.fetchChapters(mangaPath, id, mangaPage);
    switch (this.lang) {
      case "en":
        return chapters.filter((it) => !it.name.endsWith(" raw"));
      case "ko":
        return chapters.filter((it) => it.name.endsWith(" raw"));
      default:
        return [];
    }
  }
}
