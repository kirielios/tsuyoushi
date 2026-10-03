// Port of keiyoushi/extensions-source src/en/lilymanga/LilyManga.kt
import { ClientBuilder, DateTimeFormatter, Locale } from "../../../sdk/index.ts";
import { ChapterMode, MadaraNoAjax } from "../../../themes/madara/index.ts";

export default class LilyManga extends MadaraNoAjax {
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("dd.MM.yyyy", Locale.US);
  protected override genreDirectory = "gl-genre";
  protected override mangaSubString = "gl";
  protected override chapterMode = ChapterMode.MangaAjax;

  protected override configureClient(b: ClientBuilder) {
    return b.rateLimit(1, 2000, (it) => it.host === new URL(this.baseUrl).host);
  }
}
