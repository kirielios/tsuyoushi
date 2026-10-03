// Port of keiyoushi/extensions-source src/en/comicasura/ComicAsura.kt
import { Filter, FilterList, SChapter, SManga, toHttpUrl, urlWithoutDomain, type ClientBuilder, type Document, type Element } from "../../../sdk/index.ts";
import { GenreListFilter, MangaThemesia, OrderByFilter, StatusFilter, TypeFilter, type GenreData } from "../../../themes/mangathemesia/index.ts";

const DATE_SUFFIX_REGEX = /(?<=\d)(st|nd|rd|th)/g;

export default class ComicAsura extends MangaThemesia {
  override datePattern = "MMMM d yyyy";

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(1, 2_000);
  }

  protected override get popularFilter() {
    return FilterList(new OrderByFilter("", this.orderByFilterOptions, "rating"));
  }
  protected override get latestFilter() {
    return FilterList(new OrderByFilter("", this.orderByFilterOptions, "latest"));
  }

  override searchMangaUrlWithFilters(page: number, query: string, filters: FilterList) {
    const b = toHttpUrl(`${this.baseUrl}/advanced-search`).newBuilder();
    b.addQueryParameter("name", query);
    b.addQueryParameter("page", String(page));

    for (const filter of filters) {
      if (filter instanceof StatusFilter) b.addQueryParameter("status", filter.selectedValue());
      else if (filter instanceof TypeFilter) b.addQueryParameter("type", filter.selectedValue().toLowerCase());
      else if (filter instanceof OrderByFilter) b.addQueryParameter("sort", filter.selectedValue());
      else if (filter instanceof GenreListFilter) {
        b.addQueryParameter(
          "genres",
          filter.state
            .filter((it) => it.state !== Filter.TriState.STATE_IGNORE)
            .map((it) => it.value)
            .join("_"),
        );
      }
    }
    b.addPathSegment("");
    return b;
  }

  protected override searchMangaSelector() {
    return ".grid > a[href*=manga], .flex-wrap.flex a[href*=manga]";
  }

  protected override searchMangaFromElement(element: Element) {
    const manga = SManga.create();
    manga.thumbnail_url = this.imgAttrOf(element.select("img"));
    manga.title = element.select("img").attr("title");
    manga.url = urlWithoutDomain(element.absUrl("href"));
    return manga;
  }

  protected override searchMangaNextPageSelector() {
    return "a:has(img[alt=Next])";
  }

  override seriesDetailsSelector = ".bg-\\[\\#222222\\]:has(h1)";
  override seriesTitleSelector = ".comic-title-content";
  override seriesThumbnailSelector = "img[alt=poster]";
  override seriesDescriptionSelector = ".comic-content.mobile";
  override seriesGenreSelector = "div.hidden div:contains(Genres) + div > a";
  override seriesStatusSelector = "div:contains(Status) + div";

  protected override chapterListSelector() {
    return ".chapter-items";
  }

  protected override chapterFromElement(element: Element) {
    const chapter = SChapter.create();
    const urlElements = element.select("a");
    chapter.url = urlWithoutDomain(urlElements.attr("href"));
    chapter.name = element.select(".text-sm.text-white").text();
    chapter.date_upload = this.parseChapterDate(element.selectFirst(".text-xs.text-\\[\\#A2A2A2\\]:not(:has(span))")?.text()?.replace(DATE_SUFFIX_REGEX, ""));
    return chapter;
  }

  override pageSelector = "div > img.object-cover.mx-auto";

  protected override orderByFilterOptions: [string, string][] = [
    [this.intl.get("order_by_filter_default"), ""],
    // [this.intl.get("order_by_filter_az"), "name_asc"], // The source contains an error
    [this.intl.get("order_by_filter_za"), "name_desc"],
    [this.intl.get("order_by_filter_latest_update"), "latest"],
    [this.intl.get("order_by_filter_popular"), "rating"],
  ];

  protected override parseGenres(document: Document): GenreData[] | null {
    return document.select(".filter-dropdown-container label:has(input[name*=genres])").map((li) => ({
      name: li.selectFirst("span")!.text(),
      value: li.selectFirst("input[type=checkbox]")!.attr("value"),
    }));
  }
}
