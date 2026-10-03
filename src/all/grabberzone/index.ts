// Port of keiyoushi/extensions-source src/all/grabberzone/GrabberZone.kt
import { DateTimeFormatter, Locale, type Element, type SChapter } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madara/index.ts";

export default class GrabberZone extends Madara {
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("dd.MM.yyyy", Locale.ENGLISH);
  protected override mangaSubString = "comics";

  protected override chapterFromElement(element: Element, mangaPath: string): SChapter | null {
    const chapter = super.chapterFromElement(element, mangaPath);
    if (chapter) chapter.name = element.selectFirst("a + a")!.text();
    return chapter;
  }
}
