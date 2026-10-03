// Port of keiyoushi/extensions-source src/en/madarascans/MadaraScans.kt
import { SChapter, SManga, ifBlank, urlWithoutDomain, type Element, type PreferenceScreen } from "../../../sdk/index.ts";
import { MangaThemesia, MangaThemesiaPaidChapterHelper } from "../../../themes/mangathemesia/index.ts";

export default class MadaraScans extends MangaThemesia {
  override mangaUrlDirectory = "/series";

  override datePattern = "yyyy/MM/dd";

  private readonly paidChapterHelper = new MangaThemesiaPaidChapterHelper(undefined, ".locked");

  // support for both popular/latest tabs and search
  protected override searchMangaSelector() {
    return "div.listupd>div, div.legend-inner";
  }

  protected override searchMangaFromElement(element: Element) {
    const manga = SManga.create();
    manga.thumbnail_url = this.imgAttrOf(element.select("img"));
    // support for both popular/latest tabs and search
    const titleElement = element.select("h3.card-v-title > a, h3.legend-title > a");
    manga.title = titleElement.text();
    manga.url = urlWithoutDomain(titleElement.attr("href"));
    return manga;
  }

  // manga details
  override seriesDetailsSelector = "div.lh-container";
  override seriesTitleSelector = "h1.lh-title";
  override seriesDescriptionSelector = "div.lh-story > #manga-story";
  override seriesAltNameSelector = ".fa-info-circle";
  override seriesGenreSelector = ".lh-genres > .lh-genre-tag";
  override seriesStatusSelector = "span.status-badge-lux";
  override seriesThumbnailSelector = ".lh-poster > img";

  protected override chapterListSelector(): string {
    return this.paidChapterHelper.getChapterListSelectorBasedOnHidePaidChaptersPref(".ch-item", this.preferences);
  }

  protected override chapterFromElement(element: Element) {
    const chapter = SChapter.create();
    const urlElements = element.select("a");
    chapter.url = urlWithoutDomain(urlElements.attr("href"));
    const chapterName = ifBlank(element.select(".ch-num").text(), urlElements.first()?.text() ?? "");
    chapter.name = !element.hasClass("free") ? `🔒 ${chapterName}` : chapterName;
    const dateElement = element.select(".ch-date").text();
    chapter.date_upload = this.parseChapterDate(dateElement);
    return chapter;
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    this.paidChapterHelper.addHidePaidChaptersPreferenceToScreen(screen, this.intl);
  }

  override pageSelector = ".pagination, .legendary-pagination, .magma-pagination";
}
