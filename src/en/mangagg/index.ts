// Port of keiyoushi/extensions-source src/en/mangagg/MangaGG.kt
import { DateTimeFormatter, Locale, type Element } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class MangaGG extends Madara {
  protected override mangaSubString = "comic";
  protected override chapterMode = ChapterMode.MangaAjaxPaginated;
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("MM/dd/yyyy", Locale.US);

  protected override imageFromElement(element: Element): string | null {
    // attr(...).trim().ifEmpty { ... } chain: the first non-empty one
    const url = ["data-src", "data-lazy-src", "data-cfsrc", "data-manga-src", "src"].map((it) => element.attr(it).trim()).find((it) => it !== "") ?? "";

    // Jsoup's absUrl fails if a URL has leading spaces.
    // If it starts with http, it is already an absolute URL.
    return url.startsWith("http") ? url : (super.imageFromElement(element)?.trim() ?? null);
  }
}
