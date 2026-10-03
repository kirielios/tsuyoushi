// Port of keiyoushi/extensions-source src/id/klikmanga/KlikManga.kt
import { DateTimeFormatter, Locale } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class KlikManga extends Madara {
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("MMMM dd, yyyy", Locale.forLanguageTag("id"));
  protected override mangaSubString = "daftar-komik";
  protected override chapterMode = ChapterMode.MangaAjax;
  // Not upstream: the site moved genre archives to /genre/, so upstream finds no genre filters.
  protected override genreDirectory = "genre";
}
