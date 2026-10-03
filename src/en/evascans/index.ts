// Port of keiyoushi/extensions-source src/en/evascans/EvaScans.kt
import { urlWithoutDomain, type Element, type SChapter } from "../../../sdk/index.ts";
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

export default class EvaScans extends MangaThemesia {
  override mangaUrlDirectory = "/series";

  override seriesAltNameSelector = ".desktop-titles";

  protected override chapterFromElement(element: Element): SChapter {
    const chapter = super.chapterFromElement(element);
    const a = element.selectFirst("a");
    const isLocked = a?.hasAttr("data-bs-target") === true || a?.hasAttr("data-coin") === true || element.selectFirst(".locked-badge") != null;

    if (isLocked) {
      chapter.name = `🔒 ${chapter.name}`;
      if (!chapter.url.trim()) {
        const id = a?.attr("data-id");
        if (id?.trim()) chapter.url = urlWithoutDomain(`/?p=${id}`);
      }
    }
    return chapter;
  }
}
