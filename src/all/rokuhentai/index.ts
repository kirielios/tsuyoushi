// Port of keiyoushi/extensions-source src/all/rokuhentai/RokuHentai.kt (+ SearchResult.kt)
import {
  DateTimeFormatterBuilder,
  Filter,
  FilterList,
  HttpUrl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  ZoneOffset,
  parseHtml,
  substringAfter,
  substringBefore,
  substringBeforeLast,
  urlWithoutDomain,
  type Element,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";

// ---- SearchResult.kt
interface SearchResult {
  "manga-cards": string[];
}

const DATE_FORMAT = new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern("MMM d, yyyy, h:mm a").toFormatter(Locale.US);
const IMG_REGEX = /^background-image: url\("(.+?)"\);$/;
const THUMBNAIL_PREF = "THUMBNAIL";

/** SManga.id */
const mangaId = (m: SManga) => substringBefore(m.url.slice(m.url.lastIndexOf("/") + 1), "#");

export default class RokuHentai extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  // Customize
  private readonly offset = new Map<string, string>();

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat();
    p.key = THUMBNAIL_PREF;
    p.title = "Use thumbnails instead of the original images";
    p.summary = "After enabling, each page of the manga will display smaller and blurrier thumbnail.";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }

  private parseManga(e: Element): SManga {
    const manga = SManga.create();
    const info = e.selectFirst(".mdc-typography--caption:last-child")!.text().split(" images ");
    manga.url = urlWithoutDomain(substringBeforeLast(e.absUrl("href"), "/") + `#${info[0]},${DATE_FORMAT.tryParseDateTime(info[1], ZoneOffset.UTC)}`);
    manga.title = e.selectFirst(".site-manga-card__title--primary")!.text();
    manga.thumbnail_url = IMG_REGEX.exec(e.selectFirst(".mdc-card__media")!.attr("style"))?.[1];
    return manga;
  }

  // Popular Page
  async getPopularManga(page: number): Promise<MangasPage> {
    const url = page === 1 ? this.baseUrl : `${this.baseUrl}/_search?p=${this.offset.get("popular")}`;
    return this.parseMangasPage(await this.client.get(url));
  }

  private parseMangasPage(response: Response): MangasPage {
    const type = response.header("Content-Type")!;
    const mangas = type.includes("text/html")
      ? response
          .asJsoup()
          .select(".mdc-card > .site-popunder-ad-slot")
          .map((it) => this.parseManga(it))
      : response.parseAs<SearchResult>()["manga-cards"].map((it) => this.parseManga(parseHtml(this.host.load, it, this.baseUrl).selectFirst(".site-popunder-ad-slot")!));
    const last = mangas.at(-1);
    if (last) {
      const q = new URL(response.url).searchParams.get("q");
      const key = q !== null ? `search:${q}` : "popular";
      this.offset.set(key, mangaId(last));
    }
    return new MangasPage(mangas, mangas.length > 0);
  }

  // Latest Page
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // Search Page
  getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("Search How-To:"),
      new Filter.Header("• Search for a phrase in manga titles: this is a title."),
      new Filter.Header('• Search for manga titles containing all phrases (double quotes are required to separate phrases): "this foo" "that bar".'),
      new Filter.Header('• Exclude manga titles containing a phrase with "-" (double quotes are required): -"this is excluded".'),
      new Filter.Header("• Filter mangas by tag: group:foo."),
      new Filter.Header('• You must double-quote a tag if it contains spaces: parody:"foo bar".'),
      new Filter.Header("• Filter mangas by date: after:2000-01-01 before:2000-02."),
      new Filter.Header('• Negate a filter with "-": -language:foo.'),
    );
  }

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = HttpUrl.parse(this.baseUrl).newBuilder().addQueryParameter("q", query);
    if (page > 1) url.addPathSegment("_search").addQueryParameter("p", this.offset.get(`search:${query}`) ?? null);
    return this.parseMangasPage(await this.client.get(url.build().toString()));
  }

  // Manga Detail
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    if (fetchDetails) {
      const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
      const img = doc.selectFirst(".site-manga-info .mdc-card__media");
      const titles = doc.select(".site-manga-info__info h6");
      manga.thumbnail_url = IMG_REGEX.exec(img!.attr("style"))?.[1];
      manga.description = titles[1]?.text();
      manga.genre = doc
        .select(".mdc-chip")
        .map((it) => {
          const text = it.text().split(": ");
          if (text[0] === "artist") manga.author = text[1];
          return text[1].includes(" ") ? `${text[0]}: "${text[1]}"` : it.text();
        })
        .join(", ");
      manga.status = SManga.COMPLETED;
      // update_strategy = ONLY_FETCH_ONCE has no counterpart in our SManga
    }

    const chapter = SChapter.create();
    chapter.url = mangaId(manga);
    chapter.name = manga.title;
    chapter.date_upload = Number(substringAfter(manga.url, ","));
    chapter.chapter_number = 0;
    chapter.scanlator = `${substringBefore(substringAfter(manga.url, "#"), ",")}P`;

    return new SMangaUpdate(manga, [chapter]);
  }

  // Chapter
  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}/${chapter.url}/0#top-to-bottom`;
  }

  // Page
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const size = Number.parseInt(substringBefore(chapter.scanlator!, "P"), 10);
    const path = this.preferences.getBoolean(THUMBNAIL_PREF, false) ? "page-thumbnails" : "pages";
    return Array.from({ length: size }, (_, i) => new Page(i, "", `${this.baseUrl}/_images/${path}/${chapter.url}/${i}.jpg`));
  }
}
