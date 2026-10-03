// Port of keiyoushi/extensions-source src/en/voyceme/VoyceMe.kt (+ Dto.kt)
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  distinctBy,
  graphQLBody,
  parseGraphQLAs,
  parseHtml,
  substringAfter,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  type ClientBuilder,
  type Response,
} from "../../../sdk/index.ts";
import { LATEST_QUERY, PAGES_QUERY, POPULAR_QUERY, SEARCH_QUERY, UPDATES_QUERY } from "./queries.ts";

const ACCEPT_ALL = "*/*";
const ACCEPT_IMAGE = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

const STATIC_URL = "https://dlkfxmdtxtzpb.cloudfront.net/";
const GRAPHQL_URL = "https://graphql.voyce.me/v1/graphql";

const POPULAR_PER_PAGE = 10;

// --- Dto.kt
interface VoyceMeComic {
  author?: { username?: string | null } | null;
  chapters?: VoyceMeChapter[];
  description?: string | null;
  genres?: { genre?: { title?: string | null } | null }[];
  id?: number;
  slug?: string;
  status?: string | null;
  thumbnail?: string;
  title?: string;
}
interface VoyceMeChapter {
  created_at?: string;
  id?: number;
  images?: { image?: string }[];
  title?: string;
}
interface VoyceMeSeriesCollection {
  voyce_series?: VoyceMeComic[];
}
interface VoyceChapterImagesCollection {
  voyce_chapter_images?: { image?: string }[];
}

/** org.jsoup.parser.Parser.unescapeEntities(s, true): the common named entities and numeric references */
function unescapeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));?/g, (m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return named[name!] ?? m;
  });
}

export default class VoyceMe extends KeiSource {
  private get graphqlurlHost() {
    return toHttpUrl(GRAPHQL_URL).host;
  }
  private get staticurlHost() {
    return toHttpUrl(STATIC_URL).host;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(1, 1000, (url) => url.hostname === this.graphqlurlHost).rateLimit(2, 1000, (url) => url.hostname === this.staticurlHost);
  }

  protected override configureHeaders(headers: Headers) {
    headers.append("Accept", ACCEPT_ALL);
    return headers;
  }

  private async graphQLPost(headers: Headers, query: string, variables: unknown): Promise<Response> {
    const h = new Headers(headers);
    h.set("Content-Type", "application/json");
    return this.client.post(GRAPHQL_URL, h, graphQLBody({ query, variables }));
  }

  private comicToSManga(comic: VoyceMeComic): SManga {
    const manga = SManga.create();
    manga.title = comic.title ?? "";
    manga.author = comic.author?.username ?? "";
    manga.description = parseHtml(this.host.load, unescapeEntities(comic.description ?? ""), "").text();
    switch (comic.status ?? "") {
      case "completed":
        manga.status = SManga.COMPLETED;
        break;
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    manga.genre = (comic.genres ?? [])
      .map((it) => it.genre?.title)
      .filter((it) => it != null)
      .join(", ");
    manga.url = `/series/${comic.slug ?? ""}`;
    manga.thumbnail_url = STATIC_URL + (comic.thumbnail ?? "");
    return manga;
  }

  /** SimpleDateFormat("yyyy-MM-dd", ENGLISH).parse(createdAt)?.time: parses a prefix, in the local zone; null -> 0 */
  private chapterToSChapter(c: VoyceMeChapter, comicSlug: string): SChapter {
    const chapter = SChapter.create();
    chapter.name = c.title ?? "";
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(c.created_at ?? "");
    chapter.date_upload = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : 0;
    chapter.url = `/series/${comicSlug}/${c.id ?? -1}#comic`;
    return chapter;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const response = await this.graphQLPost(this.headers, POPULAR_QUERY, { offset: (page - 1) * POPULAR_PER_PAGE, limit: POPULAR_PER_PAGE });

    return this.parseMangaList(response);
  }

  private parseMangaList(response: Response): MangasPage {
    const comicList = (parseGraphQLAs<VoyceMeSeriesCollection>(response.text()).voyce_series ?? []).map((it) => this.comicToSManga(it));
    return new MangasPage(comicList, comicList.length === POPULAR_PER_PAGE);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const response = await this.graphQLPost(this.headers, LATEST_QUERY, { offset: (page - 1) * POPULAR_PER_PAGE, limit: POPULAR_PER_PAGE });

    return this.parseMangaList(response);
  }

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const response = await this.graphQLPost(this.headers, SEARCH_QUERY, { searchTerm: `%${query}%`, offset: (page - 1) * POPULAR_PER_PAGE, limit: POPULAR_PER_PAGE });

    return this.parseMangaList(response);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.hostname !== toHttpUrl(this.baseUrl).host || segments[0] !== "series") return null;

    const manga = SManga.create();
    manga.url = `/series/${segments[1]}`;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    return result;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const comicSlug = substringBefore(substringAfter(manga.url, "/series/"), "/");
    const headers = this.headersBuilder();
    headers.set("Referer", this.baseUrl + manga.url);
    const response = await this.graphQLPost(headers, UPDATES_QUERY, { slug: comicSlug });

    const comic = parseGraphQLAs<VoyceMeSeriesCollection>(response.text()).voyce_series?.[0];
    if (!comic) throw new Error("Collection contains no element.");
    return new SMangaUpdate(
      this.comicToSManga(comic),
      distinctBy(
        (comic.chapters ?? []).map((it) => this.chapterToSChapter(it, comic.slug ?? "")),
        (it) => it.name,
      ),
    );
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterId = Number.parseInt(substringBefore(substringAfterLast(chapter.url, "/"), "#"), 10);
    const response = await this.graphQLPost(this.headers, PAGES_QUERY, { chapterId });

    return (parseGraphQLAs<VoyceChapterImagesCollection>(response.text()).voyce_chapter_images ?? []).map((page, i) => new Page(i, this.baseUrl, STATIC_URL + (page.image ?? "")));
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const newHeaders = this.headersBuilder();
    newHeaders.append("Accept", ACCEPT_IMAGE);
    newHeaders.set("Referer", page.url);

    return { url: page.imageUrl!, headers: newHeaders };
  }
}
