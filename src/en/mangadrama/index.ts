// Port of keiyoushi/extensions-source src/en/mangadrama/MangaDrama.kt
import { LoadMoreStrategy, Madara } from "../../../themes/madaralegacy/index.ts";

export default class MangaDrama extends Madara {
  protected override useLoadMoreStrategy = LoadMoreStrategy.Never;
  protected override useNewChapterEndpoint = true;
  protected override chapterListSelector() {
    return "li.wp-manga-chapter.free-chap";
  }

  protected override searchMangaSelector() {
    return this.popularMangaSelector();
  }
}
