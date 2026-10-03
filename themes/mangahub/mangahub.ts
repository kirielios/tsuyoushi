// Port of keiyoushi/extensions-source lib-multisrc/mangahub/MangaHub.kt (with Dto.kt and Queries.kt)
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  distinctBy,
  parseAs,
  substringAfter,
  substringAfterLast,
  toHttpUrl,
  tryParseInstant,
  type Response,
} from "../../sdk/index.ts";
import { Genre, GenreList, Order, OrderBy } from "./filters.ts";

// ---- Dto.kt
interface PublicIPResponse {
  ip: string;
}
interface ApiChapterData {
  chapter: ApiChapter | null;
}
interface ApiChapter {
  pages: string;
  mangaID: number;
  number: number; // chapterNumber
}
interface ApiChapterPages {
  p: string; // page
  i: string[]; // images
}
interface ApiSearchObject {
  search: { rows: ApiMangaSearchItem[] } | null;
}
interface ApiMangaSearchItem {
  title: string;
  slug: string;
  image: string | null;
}
interface ApiMangaObject {
  manga: ApiMangaData | null;
}
interface ApiMangaData {
  title: string | null;
  status: string | null;
  image: string | null;
  author: string | null;
  artist: string | null;
  genres: string | null;
  description: string | null;
  alternativeTitle: string | null;
  slug: string | null;
  chapters: { number: number; title: string; date: string }[] | null;
}
interface GenreDto {
  name: string;
  key: string;
}

// ---- Queries.kt
const searchQuery = (mangaSource: string, query: string, genre: string, order: string, page: number) => {
  const escapedQuery = JSON.stringify(query).slice(1, -1);
  return `{
    search(x: ${mangaSource}, q: "${escapedQuery}", genre: "${genre}", mod: ${order}, offset: ${(page - 1) * 30}) {
        rows {
            title,
            slug,
            image
        }
    }
}`;
};
const mangaQuery = (mangaSource: string, slug: string) => `{
    manga(x: ${mangaSource}, slug: "${slug}") {
            title,
            slug,
            status,
            image,
            author,
            artist,
            genres,
            description,
            alternativeTitle,
            chapters {
                number,
                title,
                date
            }
    }
}`;
const pagesQuery = (mangaSource: string, slug: string, number: number) => `{
    chapter(x: ${mangaSource}, slug: "${slug}", number: ${kotlinFloat(number)}) {
            pages,
            mangaID,
            number
        }
}`;

/** Kotlin's Float.toString(): whole numbers keep ".0". */
const kotlinFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

// keiyoushi.utils.GraphQL: parseGraphQLAs / GraphQLException
class GraphQLException extends Error {}
function parseGraphQLAs<T>(response: Response): T {
  const envelope = response.parseAs<{ data?: T | null; errors?: { message: string }[] | null }>();
  if (envelope.errors?.length) throw new GraphQLException(envelope.errors.map((it) => it.message).join("\n"));
  if (envelope.data == null) throw new Error("GraphQL response is missing the 'data' field");
  return envelope.data;
}

class MangaHubCookieNotFound extends Error {
  constructor() {
    super("mhub_access cookie not found");
  }
}

export abstract class MangaHub extends KeiSource {
  abstract readonly mangaSource: string;

  private get baseApiUrl() {
    return "https://api.mghcdn.com";
  }
  private get baseCdnUrl() {
    return "https://imgx.mghcdn.com";
  }
  private get baseThumbCdnUrl() {
    return "https://thumb.mghcdn.com";
  }
  private readonly apiRegex = /mhub_access=([^;]+)/;
  private readonly spaceRegex = /\s+/g;
  private readonly apiErrorRegex = /rate\s*limit|api\s*key/;

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9");
    headers.set("Accept-Language", "en-US,en;q=0.5");
    headers.set("DNT", "1");
    headers.set("Sec-Fetch-Dest", "document");
    headers.set("Sec-Fetch-Mode", "navigate");
    headers.set("Sec-Fetch-Site", "same-origin");
    headers.set("Upgrade-Insecure-Requests", "1");
    return headers;
  }

  private get apiHeaders(): Headers {
    const h = this.headersBuilder();
    h.set("Accept", "application/json");
    h.set("Sec-Fetch-Dest", "empty");
    h.set("Sec-Fetch-Mode", "cors");
    h.set("Sec-Fetch-Site", "cross-site");
    h.delete("Upgrade-Insecure-Requests");
    return h;
  }

  private accessCookie(): string | null {
    return this.client.cookieJar.loadForRequest(this.baseUrl).find((it) => it.name === "mhub_access" && it.value !== "")?.value ?? null;
  }

  private async fetchGraphQL<T>(query: string, refreshUrl: string | null, parse: (response: Response) => T): Promise<T> {
    const body = JSON.stringify({ query });
    try {
      return parse(await this.apiRequest(body));
    } catch (e) {
      const shouldRefresh = e instanceof MangaHubCookieNotFound || (e instanceof GraphQLException && this.apiErrorRegex.test(e.message));
      if (!shouldRefresh) throw e;
      await this.refreshApiKey(refreshUrl);
      return parse(await this.apiRequest(body));
    }
  }

  private apiRequest(body: string): Promise<Response> {
    const cookie = this.accessCookie();
    if (cookie == null) throw new MangaHubCookieNotFound();
    const requestHeaders = this.apiHeaders;
    requestHeaders.set("x-mhub-access", cookie);
    requestHeaders.set("Content-Type", "application/json; charset=utf-8");
    return this.client.post(`${this.baseApiUrl}/graphql`, requestHeaders, body);
  }

  private refreshMutex: Promise<void> = Promise.resolve();
  private lastRefresh = 0;

  private refreshApiKey(refreshUrl: string | null = null): Promise<void> {
    const run = this.refreshMutex.then(() => this.doRefreshApiKey(refreshUrl));
    this.refreshMutex = run.catch(() => undefined);
    return run;
  }

  private async doRefreshApiKey(refreshUrl: string | null) {
    if (Date.now() - this.lastRefresh < 10_000) return;

    const url = toHttpUrl(refreshUrl ?? `${this.baseUrl}/chapter/martial-peak/chapter-${1000 + Math.floor(Math.random() * 2000)}`);
    const oldKey = this.accessCookie();

    const refreshHeaders = this.headersBuilder();
    refreshHeaders.set("Referer", `${this.baseUrl}/manga/${url.pathSegments[1]}`);

    for (let i = 1; i <= 2; i++) {
      this.client.cookieJar.saveFromResponse(String(url), ["mhub_access=; Max-Age=0; Path=/"]);

      const query = i === 2 ? "?reloadKey=1" : "";
      let response: Response;
      try {
        response = await this.client.get(`${url}${query}`, refreshHeaders, { ensureSuccess: false });
      } catch {
        throw new Error("An error occurred while obtaining a new API key");
      }
      const returnedKey = this.apiRegex.exec(response.header("set-cookie") ?? "")?.[1] ?? null;

      if (returnedKey !== oldKey) break; // Got an allegedly valid API key
    }

    this.lastRefresh = Date.now();
  }

  override getPopularManga(page: number): Promise<MangasPage> {
    return this.getMangaList(page, "POPULAR");
  }

  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getMangaList(page, "LATEST");
  }

  override getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let order = "POPULAR";
    let genres = "all";

    for (const filter of filters) {
      if (filter instanceof OrderBy) order = filter.values[filter.state].key;
      else if (filter instanceof GenreList) genres = filter.included.join(",").trim() ? filter.included.join(",") : "all";
    }

    return this.getMangaList(page, order, query, genres);
  }

  private async getMangaList(page: number, order: string, query = "", genres = "all"): Promise<MangasPage> {
    const rows = (await this.fetchGraphQL(searchQuery(this.mangaSource, query, genres, order, page), null, (it) => parseGraphQLAs<ApiSearchObject>(it))).search!.rows;

    const mangas = rows.map((it) => {
      const manga = SManga.create();
      manga.url = `/manga/${it.slug}`;
      manga.title = it.title;
      manga.thumbnail_url = it.image?.trim() ? `${this.baseThumbCdnUrl}/${it.image}` : undefined;
      return manga;
    });

    return new MangasPage(mangas, rows.length === 30);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${manga.url}`;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;

    const pathSegments = url.pathname.slice(1).split("/");
    const slug = pathSegments[0] === "manga" || pathSegments[0] === "chapter" ? pathSegments[1] : undefined;
    if (!slug) return null;

    const data = (await this.fetchGraphQL(mangaQuery(this.mangaSource, slug), `${this.baseUrl}/manga/${slug}`, (it) => parseGraphQLAs<ApiMangaObject>(it))).manga!;
    const manga = this.toSManga(data);
    manga.url = `/manga/${slug}`;
    return manga;
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const genres = manga.genre?.split(",").map((it) => it.trim().toLowerCase());
    if (!genres?.length) return [];
    const mangaGenres = new Set(genres);

    const filters = this.getFilterList();
    const genreList = filters.find((it) => it instanceof GenreList);
    if (!genreList) return [];
    genreList.state.filter((it) => mangaGenres.has(it.name.toLowerCase())).forEach((it) => (it.state = true));
    const orderBy = filters.find((it) => it instanceof OrderBy)!;
    orderBy.state = Math.floor(Math.random() * this.orderBy.length);

    return (await this.getSearchMangaList(1, "", filters)).mangas;
  }

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = manga.url.replace(/^\/manga\//, "");
    const data = (await this.fetchGraphQL(mangaQuery(this.mangaSource, slug), `${this.baseUrl}${manga.url}`, (it) => parseGraphQLAs<ApiMangaObject>(it))).manga!;

    return new SMangaUpdate(this.toSManga(data), this.toChapterList(data));
  }

  private toSManga(data: ApiMangaData): SManga {
    const manga = SManga.create();
    manga.title = data.title!;
    manga.author = data.author ?? undefined;
    manga.artist = data.artist ?? undefined;
    manga.genre = data.genres ?? undefined;
    manga.thumbnail_url = data.image?.trim() ? `${this.baseThumbCdnUrl}/${data.image}` : undefined;
    manga.status = data.status === "ongoing" ? SManga.ONGOING : data.status === "completed" ? SManga.COMPLETED : SManga.UNKNOWN;

    let description = data.description ?? "";
    const altTitles = (data.alternativeTitle?.split(";") ?? []).map((it) => it.trim()).filter((it) => it.length > 0);
    if (altTitles.length) {
      if (description.trim()) description += "\n\n";
      description += "Alternative Names:\n";
      description += altTitles.map((it) => `- ${it}`).join("\n");
    }
    manga.description = description;
    return manga;
  }

  private toChapterList(data: ApiMangaData): SChapter[] {
    return data
      .chapters!.map((it) => {
        const chapter = SChapter.create();
        const numberString = kotlinFloat(it.number).replace(/\.0$/, "");

        chapter.name = this.generateChapterName(it.title.trim().replace(this.spaceRegex, " "), numberString);
        chapter.url = `/${data.slug}/chapter-${kotlinFloat(it.number)}`;
        chapter.chapter_number = it.number;
        chapter.date_upload = tryParseInstant(it.date);
        return chapter;
      })
      .reverse();
  }

  private generateChapterName(title: string, number: string): string {
    if (title.includes(number)) return title;
    if (title.trim()) return `Chapter ${number} - ${title}`;
    return `Chapter ${number}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/chapter${chapter.url}`;
  }

  // Pages
  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const parts = chapter.url.split("/");
    const slug = parts[1];
    const number = parseFloat(substringAfter(parts[2], "-"));

    const chapterObject = (await this.fetchGraphQL(pagesQuery(this.mangaSource, slug, number), `${this.baseUrl}/chapter${chapter.url}`, (it) => parseGraphQLAs<ApiChapterData>(it))).chapter!;
    const pages = parseAs<ApiChapterPages>(chapterObject.pages);

    // We'll update the cookie here to match the browser's "recently" opened chapter.
    // This mimics how the browser works and gives us more chance to receive a valid API key upon refresh
    const now = Date.now();
    const recently = `{"${now}":{"mangaID":${chapterObject.mangaID},"number":${kotlinFloat(chapterObject.number)}}}`;
    const baseHttpUrl = toHttpUrl(this.baseUrl);
    // Cookie.Builder().domain(host).expiresAt(now + 60.days)
    this.client.cookieJar.saveFromResponse(this.baseUrl, [`recently=${encodeURIComponent(recently)}; Domain=${baseHttpUrl.host}; Max-Age=${60 * 24 * 60 * 60}`]);

    // Best-effort logging to further increase the chance of a valid API key
    this.logChapterView(slug, chapterObject.number);

    return pages.i.map((page, i) => new Page(i, "", `${this.baseCdnUrl}/${pages.p}${page}`));
  }

  // Mimics the browser logging a chapter view
  private logChapterView(slug: string, chapterNumber: number) {
    this.client
      .get("https://api.ipify.org?format=json", new Headers())
      .then((ipResponse) => {
        const ip = ipResponse.parseAs<PublicIPResponse>().ip;
        this.client.enqueue({ url: `${this.baseUrl}/action/logHistory2/${slug}/${kotlinFloat(chapterNumber)}?browserID=${ip}`, method: "GET", headers: this.headers });
      })
      .catch(() => undefined);
  }

  // Filters
  private readonly orderBy = [new Order("Popular", "POPULAR"), new Order("Updates", "LATEST"), new Order("A-Z", "ALPHABET"), new Order("New", "NEW"), new Order("Completed", "COMPLETED")];

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/search`)).asJsoup();

    return distinctBy(
      document.select("a.genre-label").map((it): GenreDto => ({ name: it.text(), key: substringAfterLast(it.attr("href"), "/") })),
      (it) => it.key,
    ).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = ((data as GenreDto[] | null) ?? []).map((it) => new Genre(it.name, it.key));

    const list: FilterList = [];
    if (genres.length) list.push(new GenreList(genres));
    list.push(new OrderBy(this.orderBy));
    return list;
  }
}
