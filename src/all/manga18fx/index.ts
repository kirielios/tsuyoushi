// Port of keiyoushi/extensions-source src/all/manga18fx/Manga18fx.kt
import {
  DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstance, toHttpUrl, urlWithoutDomain,
  type Element,
} from "../../../sdk/index.ts";

const toIntOrNull = (s: string | undefined): number | null => (s !== undefined && /^[+-]?\d+$/.test(s) ? Number(s) : null);

interface RelatedManga {
  url: string;
  title: string;
  thumbnail_url: string | null;
}

export class Genre {
  constructor(
    readonly name: string,
    readonly value: string | null,
  ) {}
}
export class GenreFilter extends Filter.Select<string> {
  constructor(readonly vals: Genre[]) {
    super("Genre", vals.map((it) => it.name));
  }
}
export class OrderBy {
  constructor(
    readonly name: string,
    readonly value: string | null,
  ) {}
}
export class OrderByFilter extends Filter.Select<string> {
  constructor(readonly vals: OrderBy[]) {
    super("Order by", vals.map((it) => it.name));
  }
}

// Similar to Madara, but not really
export default class Manga18fx extends KeiSource {
  private readonly chapterDateFormat = DateTimeFormatter.ofPattern("dd MMM yy", Locale.ENGLISH);

  // Popular
  async getPopularManga(page: number): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.baseUrl}/hot-manga`).newBuilder();
    if (page !== 1) builder.addQueryParameter("page", String(page));
    const document = (await this.client.get(builder.build().toString())).asJsoup();
    return this.mangaParse(document);
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/page/${page}`)).asJsoup();
    return this.mangaParse(document);
  }

  // Search
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.length > 0) {
      const fixedQuery = query.replaceAll("'", "’");
      const builder = toHttpUrl(`${this.baseUrl}/search`).newBuilder().addQueryParameter("q", fixedQuery);
      if (page !== 1) builder.addQueryParameter("page", String(page));
      return this.mangaParse((await this.client.get(builder.build().toString())).asJsoup());
    }

    const genreFilter = firstInstance(filters, GenreFilter);
    const genreOrderByFilter = firstInstance(filters, OrderByFilter);
    const selectedGenre = genreFilter.vals[genreFilter.state].value;
    const selectedGenreOrderBy = genreOrderByFilter.vals[genreOrderByFilter.state].value;

    if (selectedGenre != null) {
      const builder = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("manga-genre").addPathSegment(selectedGenre);
      if (page !== 1) builder.addPathSegment(String(page));
      if (selectedGenreOrderBy != null) builder.addQueryParameter("orderby", selectedGenreOrderBy);
      return this.mangaParse((await this.client.get(builder.build().toString())).asJsoup());
    }

    throw new Error("Select a genre to search");
  }

  private mangaParse(document: Element): MangasPage {
    const mangas =
      document
        .selectFirst(".site-body > .bixbox:last-child")
        ?.select(".page-item")
        .map((it) => this.mangaFromElement(it))
        .filter((it): it is SManga => it != null) ?? [];

    const hasNextPage = document.selectFirst("#blog-pager li.next:not(.disabled)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private mangaFromElement(element: Element): SManga | null {
    const manga = SManga.create();
    // Matches both browse and "You may also like"
    const mangaLink = element.selectFirst(".tt > a")!;
    const mangaCover = element.selectFirst("a img[data-src]");
    manga.url = urlWithoutDomain(mangaLink.absUrl("href"));
    manga.title = mangaLink.text();
    manga.thumbnail_url = mangaCover?.absUrl("src");

    if (this.lang === "en" && manga.title.endsWith(" Raw")) return null;
    return manga;
  }

  // Updates
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(document), this.chapterListParse(document));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== toHttpUrl(this.baseUrl).host) return null;
    const document = (await this.client.get(url)).asJsoup();
    const manga = this.mangaDetailsParse(document);
    manga.initialized = true;
    return manga;
  }

  private mangaDetailsParse(document: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(document.location());
    manga.title = document.selectFirst(".post-title > h1")!.text();
    manga.thumbnail_url = document.selectFirst(".summary_image img")?.absUrl("src");
    const author = document
      .select(".author-content > a")
      .map((it) => it.text())
      .join(", ");
    manga.author = author !== "Updating" ? author : undefined;
    const artist = document
      .select(".artist-content > a")
      .map((it) => it.text())
      .join(", ");
    manga.artist = artist !== "Updating" ? artist : undefined;
    manga.status = this.toStatus(document.selectFirst(".summary-heading:has(h5:contains(Status)) + .summary-content")?.text());

    // buildString { ... }
    let sb = "";
    const appendLine = (s = "") => {
      sb += `${s}\n`;
    };
    const rate = document.selectFirst("#averagerate")?.text();
    if (rate != null) {
      const rateCount = document.selectFirst("#countrate")?.text();
      if (rateCount != null) {
        if (sb.length > 0) appendLine();
        sb += "Rating: ";
        appendLine(this.getRatingString(rate, toIntOrNull(rateCount) ?? 0));
      }
    }

    const comments = toIntOrNull(document.selectFirst(".list-comments > h4")?.text().split(" ")[0]);
    if (comments != null) {
      if (sb.length > 0) appendLine();
      sb += "Comments: ";
      appendLine(String(comments));
    }

    const bookmarks = toIntOrNull(document.selectFirst(".sumbmrk")?.text().split(" ")[0]);
    if (bookmarks != null) {
      if (sb.length > 0) appendLine();
      sb += "Bookmarks: ";
      appendLine(String(bookmarks));
    }

    const dsct = document.selectFirst(".dsct")?.wholeText().trim();
    if (dsct != null) {
      if (sb.length > 0) appendLine();
      appendLine(dsct);
    }

    const alternatives = document.selectFirst(".summary-heading:has(h5:contains(Alternative)) + .summary-content")?.text().split(" / ");
    if (alternatives != null && alternatives[0] !== "N/A") {
      if (sb.length > 0) appendLine();
      appendLine("Alternative titles:");
      for (const it of alternatives) appendLine(`- ${it}`);
    }
    manga.description = sb;

    const type = document.selectFirst(".summary-heading:has(h5:contains(Type)) + .summary-content")?.text();
    const genresContent = document.select(".genres-content > a").map((it) => it.text());
    manga.genre = [...new Set([...(type != null ? [type] : []), ...genresContent])].join(", ");

    let relatedMangas: RelatedManga[] = [];
    try {
      relatedMangas =
        document
          .selectFirst(".related-manga")
          ?.select(".item")
          .map((it) => this.mangaFromElement(it))
          .filter((it): it is SManga => it != null)
          .map((it) => ({ url: it.url, title: it.title, thumbnail_url: it.thumbnail_url ?? null })) ?? [];
    } catch {
      relatedMangas = [];
    }
    manga.memo = { relatedMangas };
    return manga;
  }

  private toStatus(s: string | null | undefined): number {
    switch (s) {
      case "Ongoing":
        return SManga.ONGOING;
      case "Completed":
        return SManga.COMPLETED;
      default:
        return SManga.UNKNOWN;
    }
  }

  private chapterListParse(document: Element): SChapter[] {
    return document.select("#chapterlist li.a-h").map((it) => this.chapterFromElement(it));
  }

  private chapterFromElement(element: Element): SChapter {
    const chapterLink = element.selectFirst("a.chapter-name")!;
    const chapterDateStr = element.selectFirst(".chapter-time")?.text();
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(chapterLink.absUrl("href"));
    chapter.name = chapterLink.text();
    chapter.date_upload = this.chapterDateFormat.tryParseDate(chapterDateStr);
    return chapter;
  }

  override getChapterUrl(chapter: SChapter): string {
    if (chapter.url.startsWith(this.baseUrl)) {
      // Legacy Madara URL is absolute and has suffix `?style=list`
      return chapter.url;
    }
    return super.getChapterUrl(chapter);
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.getChapterUrl(chapter);
    const document = (await this.client.get(chapterUrl)).asJsoup();
    return this.parsePages(document);
  }

  private parsePages(document: Element): Page[] {
    return document.select(".page-break > img").map((element, index) => new Page(index, "", element.absUrl("src")));
  }

  // Related
  override get supportsRelatedMangas() {
    return true;
  }
  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const related = (manga.memo.relatedMangas as RelatedManga[] | undefined) ?? [];
    return related.map((it) => {
      const m = SManga.create();
      m.url = urlWithoutDomain(it.url);
      m.title = it.title;
      m.thumbnail_url = it.thumbnail_url ?? undefined;
      return m;
    });
  }

  // Filters
  override getFilterList(_data: unknown = null): FilterList {
    return [
      new Filter.Header("Filters do not apply to text search"),
      new GenreFilter([
      new Genre("<select>", null),
      new Genre("Adult", "adult"),
      new Genre("Drama", "drama"),
      new Genre("Harem", "harem"),
      new Genre("Seinen", "seinen"),
      new Genre("School", "school-life"),
      new Genre("Mature", "mature"),
      new Genre("Psychological", "psychological"),
      new Genre("Romance", "romance"),
      new Genre("Tragedy", "tragedy"),
      new Genre("Ecchi", "ecchi"),
      new Genre("Sci", "sci-fi"),
      new Genre("Yaoi", "yaoi"),
      new Genre("Action", "action"),
      new Genre("Martial", "martial-arts"),
      new Genre("Smut", "smut"),
      new Genre("Sports", "sports"),
      new Genre("Comedy", "comedy"),
      new Genre("Yuri", "yuri"),
      new Genre("Slice", "slice-of-life"),
      new Genre("Manhwa", "manhwa"),
      new Genre("Manhua", "manhua"),
      new Genre("Fantasy", "fantasy"),
      new Genre("Horror", "horror"),
      new Genre("Supernatural", "supernatural"),
      new Genre("Hentai", "hentai"),
      new Genre("Isekai", "isekai"),
      new Genre("Shoujo", "shoujo"),
      new Genre("Adventure", "adventure"),
      new Genre("Shounen", "shounen"),
      new Genre("Mecha", "mecha"),
      new Genre("Mystery", "mystery"),
      new Genre("Thriller", "thriller"),
      new Genre("Historical", "historical"),
      new Genre("Josei", "josei"),
      new Genre("Gender", "gender-bender"),
      new Genre("Webtoons", "webtoons"),
      new Genre("RPG", "rpg"),
      new Genre("GL", "gl"),
      new Genre("BL", "bl"),
      new Genre("Raw", "raw"),
      new Genre("Reincarnation", "reincarnation"),
      new Genre("Zombie", "zombie"),
      new Genre("Magic", "magic"),
      new Genre("Comics", "comics"),
      new Genre("Webtoon", "webtoon"),
      new Genre("Cooking", "cooking"),
      new Genre("NTR", "ntr"),
      new Genre("Doujinshi", "doujinshi"),
      new Genre("Game", "game"),
      new Genre("Vanilla", "vanilla"),
      new Genre("Demons", "demons"),
      new Genre("Family", "family"),
      new Genre("Super", "super-power"),
      new Genre("Uncensored", "uncensored-manhwa"),
      ]),
      new OrderByFilter([new OrderBy("Default", null), new OrderBy("Latest", "latest"), new OrderBy("Rating", "rating"), new OrderBy("Most Views", "views")]),
    ];
  }

  // Other
  // From ManhwaRead
  private getRatingString(rate: string, rateCount: number): string {
    const n = Number(rate);
    const ratingValue = rate.trim() === "" || Number.isNaN(n) ? 0 : n;
    let ratingStar: string;
    if (ratingValue >= 4.75) ratingStar = "★★★★★";
    else if (ratingValue >= 4.25) ratingStar = "★★★★✬";
    else if (ratingValue >= 3.75) ratingStar = "★★★★☆";
    else if (ratingValue >= 3.25) ratingStar = "★★★✬☆";
    else if (ratingValue >= 2.75) ratingStar = "★★★☆☆";
    else if (ratingValue >= 2.25) ratingStar = "★★✬☆☆";
    else if (ratingValue >= 1.75) ratingStar = "★★☆☆☆";
    else if (ratingValue >= 1.25) ratingStar = "★✬☆☆☆";
    else if (ratingValue >= 0.75) ratingStar = "★☆☆☆☆";
    else if (ratingValue >= 0.25) ratingStar = "✬☆☆☆☆";
    else ratingStar = "☆☆☆☆☆";
    if (ratingValue > 0.0) {
      let s = `${ratingStar} ${rate}`;
      if (rateCount > 0) s += ` (${rateCount})`;
      return s;
    }
    return "";
  }
}
