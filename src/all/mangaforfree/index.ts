// Port of keiyoushi/extensions-source src/all/mangaforfree/MangaForFree.kt
import { ClientBuilder } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class MangaForFree extends Madara {
  protected override chapterMode = ChapterMode.AdminAjax;

  protected override configureClient(b: ClientBuilder) {
    return b.rateLimit(1, 1000, (it: URL) => !it.pathname.startsWith("/wp-content/uploads/"));
  }

  protected override chapterListSelector() {
    switch (this.lang) {
      case "en":
        return "li.wp-manga-chapter:not(:contains(Raw))";
      case "ko":
        return "li.wp-manga-chapter:contains(Raw)";
      default:
        return super.chapterListSelector();
    }
  }
}
