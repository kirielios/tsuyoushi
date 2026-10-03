// Port of keiyoushi/extensions-source src/en/allanime/AllManga.kt (+ Dto.kt, PayloadDto.kt, Utils.kt)
import {
  GraphQLException,
  HttpException,
  KeiSource,
  ListPreference,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  graphQLBody,
  parseGraphQLAs,
  parseHtml,
  str,
  toHttpUrl,
  tryParseInstant,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { CountryFilter, GenreFilter, SortFilter, genreList, getFilters } from "./filters.ts";
import { POPULAR_QUERY, RELATED_QUERY, SEARCH_QUERY, UPDATE_QUERY } from "./queries.ts";

const LIMIT = 20;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000;
const retryAfterRegex = /again in (\d+)\s*second/;
export const urlRegex = /^https?:\/\/.*/s;
const IMAGE_CDN = "https://wp.youtube-anime.com";
const imageQualityRegex = /^https?:\/\/([^#]+)/;

const SHOW_ADULT_PREF = "pref_adult";
const SHOW_ADULT_PREF_DEFAULT = false;
const IMAGE_QUALITY_PREF = "pref_quality";
const IMAGE_QUALITY_PREF_DEFAULT = "original";

// Utils.kt
const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";
const titleSpecialCharactersRegex = /[^a-z\d]+/g;
const parseThumbnailUrl = (s: string) => (urlRegex.test(s) ? s : `${THUMBNAIL_CDN}${s}?w=250`);
function parseStatus(s: string | null | undefined): number {
  if (s == null) return SManga.UNKNOWN;
  const l = s.toLowerCase();
  if (l.includes("releasing")) return SManga.ONGOING;
  if (l.includes("finished")) return SManga.COMPLETED;
  return SManga.UNKNOWN;
}
const titleToSlug = (s: string) => s.trim().toLowerCase().replace(titleSpecialCharactersRegex, "-");

// Dto.kt
interface Edges<T> {
  edges: T[];
}
interface PopularData {
  queryPopular: { recommendations: { anyCard?: SearchManga | null }[] };
}
interface SearchData {
  mangas: Edges<SearchManga>;
}
interface SearchManga {
  _id: string;
  name: string;
  thumbnail?: string | null;
  englishName?: string | null;
}
function searchMangaToSManga(dto: SearchManga): SManga {
  const manga = SManga.create();
  manga.title = dto.englishName ?? dto.name;
  manga.url = dto._id;
  manga.memo = { slug: titleToSlug(dto.name) };
  manga.thumbnail_url = dto.thumbnail != null ? parseThumbnailUrl(dto.thumbnail) : undefined;
  return manga;
}
interface MangaUpdateData {
  manga?: Manga | null;
  episodeInfos?: ChapterData[];
}
interface Manga {
  _id: string;
  name: string;
  thumbnail?: string | null;
  description?: string | null;
  authors?: string[] | null;
  genres?: string[] | null;
  tags?: string[] | null;
  status?: string | null;
  altNames?: string[] | null;
  englishName?: string | null;
  malId?: string | null;
  aniListId?: string | null;
  relatedMangas?: Related[] | null;
  availableChaptersDetail: { sub: string[] };
}
interface Related {
  mangaId: string;
}
interface RelatedData {
  mangas?: Edges<SearchManga> | null;
  fewerGenresSearch?: Edges<SearchManga> | null;
  mangasWithIds?: SearchManga[] | null;
}
interface ChapterData {
  episodeIdNum: string | number;
  notes?: string | null;
  uploadDates?: { sub?: string | null } | null;
}
interface PageListData {
  chapterPages?: Edges<Servers> | null;
}
interface Servers {
  pictureUrlHead?: string | null;
  pictureUrls?: { url?: string | null }[];
}

const numberRegex = /\d/;

function chapterToSChapter(dto: ChapterData, mangaId: string, mangaSlug: string | undefined, legacy = false): SChapter {
  const chapterNum = String(dto.episodeIdNum);
  const chapter = SChapter.create();
  chapter.name = `Chapter ${chapterNum}`;
  if (dto.notes && !numberRegex.test(dto.notes)) chapter.name += `: ${dto.notes}`;
  // TODO: remove this path after a while, kept for downloaded chapters compatibility
  chapter.url = legacy ? `/read/${mangaId}/${mangaSlug}/chapter-${chapterNum}-sub` : chapterNum;
  chapter.memo = mangaSlug != null ? { mangaId, mangaSlug } : { mangaId };
  chapter.date_upload = tryParseInstant(dto.uploadDates?.sub);
  return chapter;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default class AllManga extends KeiSource {
  private get apiDomain() {
    return "api.mkissa.net";
  }
  private get apiUrl() {
    return `https://${this.apiDomain}/api`;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(1, 1000, (it) => it.hostname === this.apiDomain);
  }

  override getHomeUrl(): string {
    return `${this.baseUrl}/manga`;
  }

  private async gql<T>(query: string, variables: unknown): Promise<T> {
    const headers = this.headers;
    headers.set("Content-Type", "application/json; charset=utf-8");
    return parseGraphQLAs<T>((await this.client.post(this.apiUrl, headers, graphQLBody({ query, variables }))).text());
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const data = await this.gql<PopularData>(POPULAR_QUERY, { type: "manga", size: LIMIT, dateRange: 0, page, allowAdult: this.allowAdult, allowUnknown: false });
    const mangaList = data.queryPopular.recommendations.flatMap((it) => (it.anyCard ? [searchMangaToSManga(it.anyCard)] : []));
    return new MangasPage(mangaList, data.queryPopular.recommendations.length === LIMIT);
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", []);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const genre = firstInstanceOrNull(filters, GenreFilter);
    const data = await this.gql<SearchData>(SEARCH_QUERY, {
      search: {
        query: query || null,
        sortBy: firstInstanceOrNull(filters, SortFilter)?.getValue() ?? null,
        genres: genre?.included ?? null,
        excludeGenres: genre?.excluded ?? null,
        isManga: true,
        allowAdult: this.allowAdult,
        allowUnknown: false,
      },
      size: LIMIT,
      page,
      translationType: "sub",
      countryOrigin: firstInstanceOrNull(filters, CountryFilter)?.getValue() ?? "ALL",
    });
    return new MangasPage(data.mangas.edges.map(searchMangaToSManga), data.mangas.edges.length === LIMIT);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const id = toHttpUrl(url.href).pathSegments[1];
    if (id == null) throw new Error("Unsupported url");
    const tmpManga = SManga.create();
    tmpManga.url = id;
    return (await this.fetchMangaUpdate(tmpManga, [], true, false)).manga;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  wvChapterUrl: string | null = null;

  override getMangaUrl(manga: SManga): string {
    if (this.wvChapterUrl != null) return this.wvChapterUrl;
    const base = manga.url.startsWith("/") ? `${this.baseUrl}/manga/${manga.url.split("/")[2]}` : `${this.baseUrl}/manga/${manga.url}`;
    return `${base}?fromSearch=1`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const legacy = manga.url.startsWith("/");
    let mangaId: string, mangaSlug: string | undefined;
    if (legacy) {
      const parts = manga.url.split("/");
      [mangaId, mangaSlug] = [parts[2], parts[3]];
    } else [mangaId, mangaSlug] = [manga.url, str(manga.memo?.slug)];

    // Manga = null for some if not present
    const variables = { id: mangaId, showId: `manga@${mangaId}`, search: { fromSearch: true, allowAdult: true } };

    let data: MangaUpdateData | null = null;
    let lastError: Error | null = null;
    let retryDelay = RETRY_DELAY_MS;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(retryDelay);
      try {
        const result = await this.gql<MangaUpdateData>(UPDATE_QUERY, variables);
        if (result.manga != null) {
          data = result;
          break;
        }
        retryDelay += RETRY_DELAY_MS;
      } catch (e) {
        if (!(e instanceof GraphQLException)) throw e;
        // "Too many requests, please try again in N seconds."
        lastError = e;
        const requested = retryAfterRegex.exec(e.message)?.[1];
        retryDelay = requested != null ? Number(requested) * 1000 : retryDelay + RETRY_DELAY_MS;
      }
    }

    const m = data?.manga;
    if (m == null) throw lastError ?? new Error("Unable to fetch manga details");
    const chapterDetails = new Map((data!.episodeInfos ?? []).map((it) => [String(it.episodeIdNum), it]));

    return new SMangaUpdate(
      this.mangaToSManga(m),
      m.availableChaptersDetail.sub.map((chapterNum) => chapterToSChapter(chapterDetails.get(chapterNum)!, mangaId, mangaSlug, legacy)),
    );
  }

  private mangaToSManga(m: Manga): SManga {
    const manga = SManga.create();
    manga.title = m.englishName ?? m.name;
    manga.url = m._id;
    manga.memo = m.relatedMangas != null ? { slug: titleToSlug(m.name), relatedMangas: m.relatedMangas } : { slug: titleToSlug(m.name) };
    manga.thumbnail_url = m.thumbnail != null ? parseThumbnailUrl(m.thumbnail) : undefined;
    let description = "";
    if (m.description != null) description += parseHtml(this.host.load, m.description, this.baseUrl).wholeText();
    description += "\n\n";
    if (m.malId != null) description += `[MyAnimeList](https://myanimelist.net/manga/${m.malId})\n`;
    if (m.aniListId != null) description += `[AniList](https://anilist.co/manga/${m.aniListId})\n`;
    description += "\n\n";
    if (m.altNames?.length) description += "Alternative Titles:\n" + m.altNames.map((it) => `- ${it}`).join("\n");
    manga.description = description.trim();
    if (m.authors?.length) {
      manga.author = m.authors[0].trim();
      manga.artist = manga.author;
    }
    manga.genre = [...(m.genres ?? []), ...(m.tags ?? [])].map((it) => it.trim()).join(", ");
    manga.status = parseStatus(m.status);
    return manga;
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const related = (manga.memo?.relatedMangas as Related[] | undefined) ?? [];
    const genres = (manga.genre?.split(", ") ?? []).filter((it) => genreList.includes(it));
    const fewerGenres = [...genres].sort(() => Math.random() - 0.5).slice(0, Math.floor(genres.length / 2));

    if (!related.length && !genres.length) return [];

    const searchPayload = (includedGenres: string[]) => ({ query: null, sortBy: null, genres: includedGenres.length ? includedGenres : null, excludeGenres: null, isManga: true, allowAdult: this.allowAdult, allowUnknown: false });

    const data = await this.gql<RelatedData>(RELATED_QUERY, {
      ids: related.map((it) => it.mangaId),
      search: searchPayload(genres),
      fewerGenresSearch: searchPayload(fewerGenres),
      size: LIMIT,
      translationType: "sub",
    });

    const all = [...(data.mangasWithIds ?? []), ...(data.mangas?.edges ?? []), ...(data.fewerGenresSearch?.edges ?? [])];
    const seen = new Set<string>();
    return all.filter((it) => !seen.has(it._id) && (seen.add(it._id), true)).map(searchMangaToSManga);
  }

  override getChapterUrl(chapter: SChapter): string {
    if (chapter.url.startsWith("/")) {
      // /read/$mangaId/$mangaSlug/chapter-$chapterNum-sub
      const chapterUrlParts = chapter.url.split("/");
      return `${this.baseUrl}/manga/${chapterUrlParts[2]}/${chapterUrlParts[4]}`;
    }
    const mangaId = str(chapter.memo?.mangaId)!;
    return `${this.baseUrl}/manga/${mangaId}/chapter-${chapter.url}-sub`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const mangaId = str(chapter.memo?.mangaId);
    if (mangaId == null) throw new Error("Refresh Chapter List");
    const mangaUrl = `${this.baseUrl}/manga/${mangaId}?fromSearch=1`;

    const response = await this.client.get(mangaUrl, undefined, { ensureSuccess: false });
    if (!response.isSuccessful) {
      if (response.code === 403 || response.code === 503) throw new Error("Solve captcha in WebView and retry");
      throw new HttpException(response.code, response.url);
    }

    // Upstream now loads the manga page in a WebView with an injected script, lets the site's own scripts navigate to
    // the chapter and captures the "chapterPages" JSON they fetch. Site
    // code is never executed here, so this step is not ported.
    throw new Error("AllManga chapter pages are only readable by running the site's scripts in a WebView, which this app does not do");
  }

  /** The WebView payload's handling, kept for when the pages can be obtained without running site code. */
  pagesFromPayload(payload: string): Page[] {
    const pageListData = (JSON.parse(payload) as PageListData).chapterPages;
    if (pageListData == null) return [];

    const pages =
      pageListData.edges.find((it) => {
        const urls = it.pictureUrls ?? [];
        const random = urls[Math.floor(Math.random() * urls.length)];
        const fullUrlAvailable = random?.url != null && urlRegex.test(random.url);
        return fullUrlAvailable || it.pictureUrlHead != null;
      }) ?? pageListData.edges[0];
    if (pages == null) return [];

    const server = pages.pictureUrlHead;
    const imageDomain = server != null ? (urlRegex.test(server) ? `${server.replace(/\/$/, "")}/` : `https://${server.replace(/\/$/, "")}/`) : "https://ytimgf.youtube-anime.com/";

    return (pages.pictureUrls ?? []).flatMap((image, index) => {
      if (image.url == null) return [];
      const imageUrl = urlRegex.test(image.url) ? image.url : imageDomain + image.url.replace(/^\//, "");
      return [new Page(index, "", imageUrl)];
    });
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const quality = this.imageQuality;
    if (quality === IMAGE_QUALITY_PREF_DEFAULT) return super.imageRequest(page);
    const oldUrl = imageQualityRegex.exec(page.imageUrl!)![1];
    return { url: `${IMAGE_CDN}/${oldUrl}?w=${quality}`, headers: this.headers };
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const quality = new ListPreference(screen.context);
    quality.key = IMAGE_QUALITY_PREF;
    quality.title = "Image Quality";
    quality.entries = ["Original", "Wp-800", "Wp-480"];
    quality.entryValues = ["original", "800", "480"];
    quality.setDefaultValue(IMAGE_QUALITY_PREF_DEFAULT);
    quality.summary = "Warning: Wp quality servers can be slow and might not work sometimes";
    screen.addPreference(quality);

    const adult = new SwitchPreferenceCompat(screen.context);
    adult.key = SHOW_ADULT_PREF;
    adult.title = "Show Adult Content";
    adult.setDefaultValue(SHOW_ADULT_PREF_DEFAULT);
    screen.addPreference(adult);
  }

  private get allowAdult() {
    return this.preferences.getBoolean(SHOW_ADULT_PREF, SHOW_ADULT_PREF_DEFAULT);
  }
  private get imageQuality() {
    return this.preferences.getString(IMAGE_QUALITY_PREF, IMAGE_QUALITY_PREF_DEFAULT)!;
  }
}
