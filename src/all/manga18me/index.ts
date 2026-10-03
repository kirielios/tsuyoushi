// Port of keiyoushi/extensions-source src/all/manga18me/Manga18Me.kt (+ Filters.kt)
import { DateTimeFormatter, Filter, FilterList, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, toHttpUrl, urlWithoutDomain, type Element, type Request, type Response } from "../../../sdk/index.ts";

// --- Filters.kt
class CheckBoxFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value = "",
  ) {
    super(name, false);
  }
}
class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly vals: [string, string][],
    state = 0,
  ) {
    super(
      name,
      vals.map((it) => it[0]),
      state,
    );
  }
  getValue() {
    return this.vals[this.state][1];
  }
}
class GenreFilter extends SelectFilter {}
class SortFilter extends SelectFilter {}
class CompletedFilter extends CheckBoxFilter {}
class RawFilter extends CheckBoxFilter {}

// Filters Data
const getGenresList: [string, string][] = [
  ["Manga", "manga"],
  ["Drama", "drama"],
  ["Mature", "mature"],
  ["Romance", "romance"],
  ["Adult", "adult"],
  ["Hentai", "hentai"],
  ["Comedy", "comedy"],
  ["Ecchi", "ecchi"],
  ["School Life", "school-life"],
  ["Shounen", "shounen"],
  ["Slice of Life", "slice-of-life"],
  ["Seinen", "seinen"],
  ["Yuri", "yuri"],
  ["Action", "action"],
  ["Fantasy", "fantasy"],
  ["Harem", "harem"],
  ["Supernatural", "supernatural"],
  ["Sci-Fi", "sci-fi"],
  ["Isekai", "isekai"],
  ["Shoujo", "shoujo"],
  ["Horror", "horror"],
  ["Psychological", "psychological"],
  ["Smut", "smut"],
  ["Tragedy", "tragedy"],
  ["Raw", "raw"],
  ["Historical", "historical"],
  ["Adventure", "adventure"],
  ["Martial Arts", "martial-arts"],
  ["Manhwa", "manhwa"],
  ["Manhua", "manhua"],
  ["Mystery", "mystery"],
  ["BL", "bl"],
  ["Yaoi", "yaoi"],
  ["Gender Bender", "gender-bender"],
  ["Thriller", "thriller"],
  ["Josei", "josei"],
  ["Sports", "sports"],
  ["GL", "gl"],
  ["Family", "family"],
  ["Magic", "magic"],
];
const getSortsList: [string, string][] = [
  ["Latest", "latest"],
  ["A-Z", "alphabet"],
  ["Rating", "rating"],
  ["Trending", "trending"],
];

function getFilters(): FilterList {
  return FilterList(new Filter.Header("The filter is ignored when using text search."), new GenreFilter("Genre", getGenresList), new SortFilter("Sort", getSortsList), new RawFilter("Raw"), new CompletedFilter("Completed"));
}

export default class Manga18Me extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  // upstream sends only a Referer (the client adds the User-Agent)
  override headersBuilder(): Headers {
    const headers = super.headersBuilder();
    headers.append("Referer", `${this.baseUrl}/`);
    return headers;
  }

  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/manga/${page}?orderby=trending`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const entries = document.select("div.page-item-detail");
    const hasNextPage = document.selectFirst(".next") != null;
    if (this.lang === "en") {
      const searchText = document.selectFirst("div.section-heading h1")?.text() ?? "";
      const raw = document.selectFirst("div.canonical")?.attr("href") ?? "";
      return new MangasPage(
        entries
          .filter((element) => {
            const href = element.selectFirst("div.item-thumb.wleft a")?.attr("href") ?? "";
            return searchText.toLowerCase().includes("raw") || raw.includes("raw") || !href.includes("raw");
          })
          .map((e) => this.parseMangaFromElement(e)),
        hasNextPage,
      );
    }
    return new MangasPage(
      entries.map((e) => this.parseMangaFromElement(e)),
      hasNextPage,
    );
  }

  private parseMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const href = element.selectFirst("a")?.absUrl("href");
    if (href != null) manga.url = urlWithoutDomain(href);
    const alt = element.selectFirst("div.item-thumb.wleft img")?.attr("alt");
    if (alt != null) manga.title = alt;
    manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
    return manga;
  }

  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/manga/${page}?orderby=latest`, this.headers);
  }
  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    if (query.length === 0) {
      let completed = false;
      let raw = false;
      let genre = "";
      for (const it of filters) {
        if (it instanceof GenreFilter) genre = it.getValue();
        else if (it instanceof CompletedFilter) completed = it.state;
        else if (it instanceof RawFilter) raw = it.state;
        else if (it instanceof SortFilter) url.addQueryParameter("orderby", it.getValue());
      }
      if (raw) {
        url.addPathSegment("raw");
      } else if (completed) {
        url.addPathSegment("completed");
      } else {
        if (genre !== "manga") url.addPathSegment("genre");
        url.addPathSegment(genre);
      }
      url.addPathSegment(String(page));
    } else {
      url.addPathSegment("search");
      url.addQueryParameter("q", query);
      url.addQueryParameter("page", String(page));
    }
    return GET(url.build().toString(), this.headers);
  }
  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const info = document.selectFirst("div.post_content");
    const manga = SManga.create();
    manga.title = document.select("div.post-title.wleft > h1").text();

    let description = "";
    const ss = document.selectFirst("div.ss-manga")?.wholeText();
    if (ss != null && ss !== "N/A" && ss.length > 0) description += `${ss}\n`;
    const alt = info?.selectFirst("div.post-content_item.wleft:contains(Alternative) div.summary-content")?.text();
    if (alt != null && alt !== "Updating" && alt.length > 0) {
      description += "Alternative Names:\n";
      for (const a of alt.split(/[/;]/)) description += `- ${a.trim()}\n`;
    }
    manga.description = description;

    const statusElement = info?.selectFirst("div.post-content_item.wleft:contains(Status) div.summary-content");
    switch (statusElement?.text()) {
      case "Ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "Completed":
        manga.status = SManga.COMPLETED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    const artist = info?.selectFirst("div.href-content.artist-content > a")?.text();
    manga.author = artist != null && artist !== "Updating" ? artist : undefined;
    manga.artist = artist != null && artist !== "Updating" ? artist : undefined;
    manga.genre = info?.select("div.href-content.genres-content > a[href*=/manga-list/]").eachText().join(", ");
    manga.thumbnail_url = document.selectFirst("div.summary_image > img")?.absUrl("src");
    return manga;
  }

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    return document.select("ul.row-content-chapter.wleft .a-h.wleft").map((e) => this.parseChapterFromElement(e));
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH);
  private parseChapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const a = element.selectFirst("a");
    if (a) {
      chapter.url = urlWithoutDomain(a.absUrl("href"));
      chapter.name = a.text();
    }
    chapter.date_upload = this.dateFormat.tryParseDate(element.selectFirst("span")?.text());
    return chapter;
  }

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    const contents = document.select("div.read-content.wleft img");
    if (contents.isEmpty()) throw new Error("Unable to find script with image data");
    return contents.map((image, idx) => new Page(idx, "", image.attr("src")));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  override getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }
}
