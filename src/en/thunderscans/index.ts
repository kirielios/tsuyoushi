// Port of keiyoushi/extensions-source src/en/thunderscans/ThunderScans.kt
import type { Element, PreferenceScreen, SChapter, SManga } from "../../../sdk/index.ts";
import { MangaThemesiaAlt, MangaThemesiaPaidChapterHelper } from "../../../themes/mangathemesia/index.ts";

export default class ThunderScans extends MangaThemesiaAlt {
  override mangaUrlDirectory = "/comics";

  private readonly paidChapterHelper = new MangaThemesiaPaidChapterHelper();

  searchMangaTitleSelector = ".bigor .tt, h3 a";

  protected override searchMangaFromElement(element: Element): SManga {
    const manga = super.searchMangaFromElement(element);
    manga.title = element.selectFirst(this.searchMangaTitleSelector)?.text() || element.selectFirst("a")!.attr("title");
    return manga;
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    super.setupPreferenceScreen(screen);
    this.paidChapterHelper.addHidePaidChaptersPreferenceToScreen(screen, this.intl);
  }

  protected override chapterListSelector(): string {
    return this.paidChapterHelper.getChapterListSelectorBasedOnHidePaidChaptersPref(super.chapterListSelector(), this.preferences);
  }

  protected override chapterFromElement(element: Element): SChapter {
    const chapter = super.chapterFromElement(element);
    if (!chapter.url.trim()) {
      const a = element.selectFirst("a")!;
      chapter.url = `#locked-${a.attr("data-id")}`;
      chapter.name = `🔒 ${chapter.name}`;
    }
    return chapter;
  }
}
