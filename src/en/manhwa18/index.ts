// Port of keiyoushi/extensions-source src/en/manhwa18/Manhwa18.kt (+ Filters.kt)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstanceOrNull,
  substringAfter,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type FilterList as FilterListType,
  type HttpUrl,
} from "../../../sdk/index.ts";

const dateFormat = DateTimeFormatter.ofPattern("d/M/yyyy", Locale.ENGLISH);

// --- Filters.kt
class SortFilter extends Filter.Select<string> {
  constructor() {
    super("Order", ["Latest update", "New manhwa", "Most view", "Most like", "A - Z", "Z - A"]);
  }
  selectedValue() {
    switch (this.state) {
      case 0:
        return "update";
      case 1:
        return "new";
      case 2:
        return "top";
      case 3:
        return "like";
      case 4:
        return "az";
      case 5:
        return "za";
      default:
        return "update";
    }
  }
}

class StatusFilter extends Filter.Select<string> {
  constructor() {
    super("Status", ["All", "Ongoing", "On hold", "Completed"]);
  }
  selectedValue() {
    return String(this.state);
  }
}

class Genre extends Filter.CheckBox {
  constructor(name: string, readonly id: string) {
    super(name);
  }
}

class GenreFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
}

const genreList = ([
  ["Adult", "4"],
  ["Doujinshi", "9"],
  ["Harem", "17"],
  ["Manga", "24"],
  ["Manhwa", "26"],
  ["Mature", "28"],
  ["NTR", "33"],
  ["Romance", "36"],
  ["Webtoon", "57"],
  ["Action", "59"],
  ["Comedy", "60"],
  ["BL", "61"],
  ["Horror", "62"],
  ["Raw", "63"],
  ["Uncensore", "64"],
  ["Art", "65"],
  ["M18Scan", "66"],
  ["Drama", "68"],
  ["Supernatural", "128"],
  ["Seinen", "160"],
  ["Borderline H", "161"],
  ["Full Color", "162"],
  ["Slice of Life", "163"],
  ["Smut", "164"],
  ["Uncensored", "165"],
  ["Webtoons", "166"],
  ["Explicit Sex", "167"],
  ["Cohabitation", "168"],
  ["Delinquents", "169"],
  ["Fetish", "170"],
  ["Nudity", "171"],
  ["Sexual Abuse", "172"],
  ["Sexual Content", "173"],
  ["Fantasy", "174"],
  ["Ghosts", "175"],
  ["Historical", "176"],
  ["School Life", "177"],
  ["Psychological", "178"],
  ["Incest", "179"],
  ["Japanese Webtoons", "180"],
  ["Coworkers", "181"],
  ["Salaryman", "182"],
  ["Siblings", "183"],
  ["Work Life", "184"],
  ["Gyaru", "185"],
  ["Based on Another Work", "186"],
  ["Demons", "187"],
  ["Crime", "188"],
  ["Mystery", "189"],
  ["Reverse Harem", "190"],
  ["Adventure", "191"],
  ["Isekai", "192"],
  ["Magic", "193"],
  ["Thriller", "194"],
  ["Time Travel", "195"],
  ["Reincarnation", "196"],
  ["Sports", "197"],
  ["Medical", "198"],
  ["Sci Fi", "199"],
  ["AI Art", "200"],
  ["Animal Characteristics", "201"],
  ["Monster Girls", "202"],
  ["Violence", "203"],
  ["Collection of Stories", "204"],
  ["Ecchi", "205"],
  ["Monsters", "206"],
  ["Survival", "207"],
] as [string, string][]).map(([name, id]) => new Genre(name, id));

// --- Manhwa18.kt
export default class Manhwa18 extends KeiSource {
  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangaList(toHttpUrl(`${this.baseUrl}/tim-kiem?sort=top&page=${page}`)!);
  }

  private async parseMangaList(url: HttpUrl): Promise<MangasPage> {
    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = document.select(".thumb-item-flow").map((element) => {
      const manga = SManga.create();
      const a = element.selectFirst("a")!;
      manga.url = urlWithoutDomain(a.attr("abs:href"));
      manga.title = element.selectFirst(".series-title a")!.text();
      const bg = element.selectFirst(".lazy-bg")?.attr("data-bg");
      const style = element.selectFirst(".img-in-ratio")?.attr("style");
      manga.thumbnail_url = bg ?? (style == null ? undefined : substringBefore(substringAfter(style, "url('"), "')"));
      return manga;
    });
    const hasNextPage = document.selectFirst(".pagination_wrap a.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseMangaList(toHttpUrl(`${this.baseUrl}/tim-kiem?sort=update&page=${page}`)!);
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/tim-kiem`)!.newBuilder();

    if (query.length > 0) url.addQueryParameter("q", query);

    const sortFilter = firstInstanceOrNull(filters, SortFilter);
    const statusFilter = firstInstanceOrNull(filters, StatusFilter);
    const genreFilter = firstInstanceOrNull(filters, GenreFilter);

    url.addQueryParameter("sort", sortFilter?.selectedValue() ?? "update");

    if (statusFilter != null && statusFilter.state !== 0) url.addQueryParameter("status", statusFilter.selectedValue());

    if (genreFilter != null) {
      const included = genreFilter.state.filter((it) => it.state).map((it) => it.id).join(",");
      if (included.length > 0) url.addQueryParameter("accept_genres", included);
    }

    url.addQueryParameter("page", String(page));

    return this.parseMangaList(url.build());
  }

  // ============================== Details ==============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const details = SManga.create();
    details.url = manga.url;
    details.title = document.selectFirst(".series-name a, .au-bento h1, .au-crumb a:last-child")!.text();
    const cover = document.selectFirst(".series-cover .img-in-ratio")?.attr("style");
    details.thumbnail_url = cover == null ? undefined : substringBefore(substringAfter(cover, "url('"), "')");
    details.description = document.selectFirst(".summary-content")?.text();

    const infoItems = document.select(".series-information .info-item");
    for (const item of infoItems) {
      const name = item.selectFirst(".info-name")?.text();
      if (name == null) continue;
      const value = item.selectFirst(".info-value")?.text();
      if (value == null) continue;

      if (name.toLowerCase().includes("author")) details.author = value;
      else if (name.toLowerCase().includes("genre")) details.genre = item.select(".info-value a").map((it) => it.text()).join(", ");
      else if (name.toLowerCase().includes("status")) {
        switch (value.toLowerCase().replaceAll(" ", "")) {
          case "ongoing":
            details.status = SManga.ONGOING;
            break;
          case "completed":
            details.status = SManga.COMPLETED;
            break;
          case "onhold":
            details.status = SManga.ON_HIATUS;
            break;
          default:
            details.status = SManga.UNKNOWN;
        }
      }
    }

    // Fallback for author field if not strictly displayed in info items
    if (!details.author) details.author = document.selectFirst(".fantrans-value a")?.text();

    const chapterList = document.select("div.au-chgrid a.au-chtile, ul.list-chapters > a").map((a) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(a.attr("abs:href"));
      chapter.name = a.attr("data-name") || a.attr("title");

      const au = a.selectFirst(".au-chtile-date")?.text();
      const ct = a.selectFirst(".chapter-time")?.text();
      const timeStr = au != null ? substringAfter(au, "·").trim() : ct != null ? substringAfter(ct, "-").trim() : undefined;
      chapter.date_upload = dateFormat.tryParseDate(timeStr);
      return chapter;
    });

    return new SMangaUpdate(details, chapterList);
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("#chapter-content img.lazy").map((img, i) => new Page(i, "", img.attr("abs:data-src")));
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterListType {
    return FilterList(new SortFilter(), new StatusFilter(), new GenreFilter(genreList));
  }
}
