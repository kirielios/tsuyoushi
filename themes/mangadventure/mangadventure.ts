// Port of keiyoushi/extensions-source lib-multisrc/mangadventure/MangAdventure.kt and MangAdventureAPI.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, type Response } from "../../sdk/index.ts";
import { Artist, Author, CategoryList, SortOrder, Status, isUriFilter } from "./filters.ts";

// MangAdventureAPI.kt
/** Generic results wrapper schema. */
interface Results<T> {
  results: T[];
}
/** Generic paginator schema. */
interface Paginator<T> {
  last: boolean;
  results: T[];
}
/** Page model schema. */
interface MAPage {
  id: number;
  image: string;
  number: number;
  url: string;
}
/** Chapter model schema. */
interface Chapter {
  id: number;
  title: string;
  number: number;
  volume: number | null;
  published: string;
  final: boolean;
  series: string;
  groups: string[];
  full_title: string;
}
/** Series model schema. */
interface Series {
  slug: string;
  title: string;
  cover: string;
  description?: string | null;
  status?: string | null;
  licensed?: boolean | null;
  aliases?: string[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
  categories?: string[] | null;
}

/** Manga categories from MangAdventure `categories.xml` fixture. */
export const DEFAULT_CATEGORIES = [
  "4-Koma",
  "Action",
  "Adventure",
  "Comedy",
  "Doujinshi",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Gender Bender",
  "Harem",
  "Hentai",
  "Historical",
  "Horror",
  "Josei",
  "Martial Arts",
  "Mecha",
  "Mystery",
  "Psychological",
  "Romance",
  "School Life",
  "Sci-Fi",
  "Seinen",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Sports",
  "Supernatural",
  "Tragedy",
  "Yaoi",
  "Yuri",
];

/** A user agent representing Tachiyomi. */
// ponytail: upstream reads Build.VERSION.RELEASE and the app version; there is no Android here, so they are fixed.
const userAgent = "Mozilla/5.0 (Android 14; Mobile) Tachiyomi/0.16.4";

/** MangAdventure base source. */
export abstract class MangAdventure extends KeiSource {
  /** The site's manga categories. */
  protected categories = DEFAULT_CATEGORIES;

  /** The site's manga status names. */
  protected statuses = ["Any", "Completed", "Ongoing", "Hiatus", "Cancelled"];

  /** The site's sort order labels that correspond to SortOrder's values. */
  protected orders = ["Title", "Views", "Latest upload", "Chapter count"];

  /** The URL of the site's API. */
  private get apiUrl() {
    return `${this.baseUrl}/api/v2`;
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("User-Agent", userAgent);
    return headers;
  }

  override async getLatestUpdates(page: number) {
    return this.parseMangasPage(await this.client.get(`${this.apiUrl}/series?page=${page}&sort=-latest_upload`));
  }

  override async getPopularManga(page: number) {
    return this.parseMangasPage(await this.client.get(`${this.apiUrl}/series?page=${page}&sort=-views`));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/");
    if (url.host !== new URL(this.baseUrl).host || pathSegments.length < 2) return null;
    return this.fetchManga(pathSegments[1]);
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.apiUrl).newBuilder().addEncodedPathSegment("series");
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("title", query);
    filters.filter(isUriFilter).forEach((it) => url.addQueryParameter(it.param, it.toString()));

    return this.parseMangasPage(await this.client.get(url.build().toString()));
  }

  private parseMangasPage(response: Response) {
    const it = response.parseAs<Paginator<Series>>();
    return new MangasPage(
      it.results.map((s) => this.mangaFromJSON(s)),
      !it.last,
    );
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchManga(manga.url) : manga, fetchChapters ? this.fetchChapterList(manga) : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  private async fetchManga(slug: string) {
    return this.mangaFromJSON((await this.client.get(`${this.apiUrl}/series/${slug}`)).parseAs<Series>());
  }

  private async fetchChapterList(manga: SManga) {
    return (await this.client.get(`${this.apiUrl}/series/${manga.url}/chapters?date_format=timestamp`)).parseAs<Results<Chapter>>().results.map((chapter) => {
      const c = SChapter.create();
      c.url = String(chapter.id);
      c.name = chapter.full_title + (chapter.final ? " [END]" : "");
      c.chapter_number = chapter.number;
      c.date_upload = Number(chapter.published);
      c.scanlator = chapter.groups.join(", ");
      return c;
    });
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(`${this.apiUrl}/chapters/${chapter.url}/pages?track=true`)).parseAs<Results<MAPage>>().results.map((page) => new Page(page.number, "", page.image));
  }

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}/reader/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter) {
    return `${this.apiUrl}/chapters/${chapter.url}/read`;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Author(), new Artist(), new Status(this.statuses), new SortOrder(this.orders), new CategoryList(this.categories));
  }

  /** Converts a Series object to an SManga. */
  private mangaFromJSON(series: Series): SManga {
    const manga = SManga.create();
    manga.url = series.slug;
    manga.title = series.title;
    manga.thumbnail_url = series.cover;
    let description = series.description ?? "";
    if (series.aliases?.length) description += "\n\nAlternative titles:\n" + series.aliases.join("\n");
    manga.description = description;
    manga.author = series.authors?.join(", ");
    manga.artist = series.artists?.join(", ");
    manga.genre = series.categories?.join(", ");
    if (series.licensed === true) manga.status = SManga.LICENSED;
    else {
      manga.status = { completed: SManga.COMPLETED, ongoing: SManga.ONGOING, hiatus: SManga.ON_HIATUS, canceled: SManga.CANCELLED }[series.status ?? ""] ?? SManga.UNKNOWN;
    }
    return manga;
  }
}
