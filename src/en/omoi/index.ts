// Port of keiyoushi/extensions-source src/en/omoi/Azuki.kt (+ Dto.kt, ImageInterceptor.kt)
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  substringAfter,
  toHttpUrl,
  tryParseInstant,
  type Chain,
  type ClientBuilder,
  type HttpUrl,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { AccessTypeFilter, GenreFilter, PublisherFilter, SortFilter } from "./filters.ts";

// --- Dto.kt
interface Webp {
  url: string;
  width: number;
}
interface Image {
  webp: Webp[];
}
interface DetailsDto {
  slug: string;
  uuid: string;
  name: string;
  short_description?: string | null;
  is_complete?: boolean | null;
  image?: Image | null;
  tags?: string[] | null;
  creators?: { name: string }[] | null;
  credits?: string | null;
  release_schedule?: string | null;
  alt_titles?: { name: string }[] | null;
}
interface ChapterDto {
  chapters: Chapter[];
}
interface Chapter {
  uuid: string;
  title?: string | null;
  label: string;
  release_date?: string | null;
  free_published_date?: string | null;
  free_unpublished_date?: string | null;
  is_upcoming?: boolean | null;
}
interface UserMangaStatusDto {
  purchased_chapter_uuids?: string[];
  unlocked_chapter_uuids?: string[];
}
interface PageListDto {
  data: { pages: { image: Image }[] };
}

const maxByWidth = (webp: Webp[]): Webp => {
  if (webp.length === 0) throw new Error("NoSuchElementException");
  return webp.reduce((a, b) => (b.width > a.width ? b : a));
};
const highResOf = (url: string) => url.replace(/\/\d+_/g, "/2400_");
const isBlank = (s: string | null | undefined) => s == null || s.trim() === "";

function detailsToSManga(d: DetailsDto): SManga {
  const m = SManga.create();
  m.url = `${d.slug}#${d.uuid}`;
  m.title = d.name;
  m.thumbnail_url = d.image?.webp ? highResOf(maxByWidth(d.image.webp).url) : undefined;
  m.author = d.creators?.map((it) => it.name).join(", ");
  let description = String(d.short_description ?? null); // StringBuilder.append(null) writes "null"
  if (!isBlank(d.credits)) description += `\n\n${d.credits}`;
  if (d.alt_titles && d.alt_titles.length > 0) {
    description += "\n\nAlternative Titles:";
    for (const it of d.alt_titles) description += `\n${it.name}`;
  }
  if (!isBlank(d.release_schedule)) description += `\n\n${d.release_schedule}`;
  m.description = description;
  m.genre = d.tags?.join(", ");
  m.status = d.is_complete === true ? SManga.COMPLETED : SManga.ONGOING;
  return m;
}

function chapterToSChapter(c: Chapter, slug: string, isLocked: boolean): SChapter {
  const ch = SChapter.create();
  ch.url = `${c.uuid}#${slug}`;
  const chapter = `Chapter ${c.label}`;
  const fullTitle = c.title != null ? `${chapter} - ${c.title}` : chapter;
  const upcoming = c.is_upcoming === true ? `${fullTitle} - [Upcoming]` : fullTitle;
  ch.name = isLocked ? `🔒 ${upcoming}` : upcoming;
  ch.date_upload = tryParseInstant(c.release_date);
  return ch;
}

const HIDE_LOCKED_PREF_KEY = "hide_locked";

export default class Azuki extends KeiSource {
  private readonly apiUrl = "https://production.api.azuki.co";
  private readonly organizationKey = "199e5a19-a236-49f5-81f4-43d4a541748a";

  protected override configureClient(builder: ClientBuilder) {
    return builder
      .addChainInterceptor((chain) => this.imageIntercept(chain))
      .addChainInterceptor(async (it) => {
        const request = it.request();
        const response = await it.proceed(request);
        const url = new URL(request.url);
        const isPages = () => (url.pathname.split("/")[3] ?? "").includes("pages"); // pathSegments[2]
        if ((response.code === 401 || response.code === 403) && isPages() && url.host === new URL(this.apiUrl).host) {
          throw new Error("Log in via WebView and purchase this chapter to read.");
        }
        if (response.code === 404 && isPages() && url.host === new URL(this.apiUrl).host) {
          throw new Error("This chapter is not available.");
        }
        return response;
      });
  }

  // ImageInterceptor.kt
  private async imageIntercept(chain: Chain): Promise<Response> {
    const request = chain.request();
    const response = await chain.proceed(request);
    if (!response.isSuccessful || !new URL(request.url).searchParams.has("drm")) return response;

    const bytes = response.bytes().slice();
    // https://www.azuki.co/assets/js/DecryptedImage.57631a1f.js
    for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i] ^ 174;
    return response.withBody(bytes);
  }

  // Popular
  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangaList(toHttpUrl(`${this.baseUrl}/discover?sort=popular&page=${page}`));
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseMangaList(toHttpUrl(`${this.baseUrl}/discover?sort=recent_series&page=${page}`));
  }

  // Search
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/discover`).newBuilder();
    url.addQueryParameter("page", String(page));
    if (query.trim() !== "") url.addQueryParameter("q", query);
    const sort = firstInstanceOrNull(filters, SortFilter)?.value;
    if (sort != null) url.addQueryParameter("sort", sort);

    const accessType = firstInstanceOrNull(filters, AccessTypeFilter)?.value;
    if (accessType) url.addQueryParameter("access_type", accessType);

    const publisher = firstInstanceOrNull(filters, PublisherFilter)?.value;
    if (publisher) url.addQueryParameter("publisher_slug", publisher);

    firstInstanceOrNull(filters, GenreFilter)
      ?.state.filter((it) => it.state)
      .forEach((it) => url.addQueryParameter("tags[]", it.value));
    return this.parseMangaList(url.build());
  }

  private async parseMangaList(url: HttpUrl): Promise<MangasPage> {
    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = document.select("ol.o-series-card-list li").map((it) => {
      const manga = SManga.create();
      const link = it.selectFirst("a.a-card-link")!;
      const uuid = substringAfter(link.attr("data-ga-item-id"), "series-");
      const segments = toHttpUrl(link.absUrl("href")).pathSegments;
      const slug = segments[segments.length - 1];
      manga.url = `${slug}#${uuid}`; // setUrlWithoutDomain
      manga.title = link.text();
      manga.thumbnail_url = it.selectFirst("img")?.absUrl("src");
      return manga;
    });
    const hasNextPage = document.selectFirst("a[rel=next]") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Details & Chapters
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const url = toHttpUrl(`${this.baseUrl}/${manga.url}`);
    const slug = url.pathSegments[0];

    const details = fetchDetails ? this.client.get(`${this.apiUrl}/manga/slug/${slug}/v0`, await this.apiHeaders()).then((r) => detailsToSManga(r.parseAs<DetailsDto>())) : null;
    const chapterList = fetchChapters ? this.getChapterList(slug, url.fragment!) : null;

    const [d, c] = await Promise.all([details, chapterList]);
    return new SMangaUpdate(d ?? manga, c ?? chapters);
  }

  override getMangaUrl(manga: SManga): string {
    const slug = toHttpUrl(`${this.baseUrl}/${manga.url}`).pathSegments[0];
    return `${this.baseUrl}/series/${slug}`;
  }

  private async getChapterList(slug: string, uuid: string): Promise<SChapter[]> {
    const chapterUrl = toHttpUrl(`${this.apiUrl}/mangas/${uuid}/chapters/v4`).newBuilder().addQueryParameter("order", "ascending").addQueryParameter("count", "1000").build();
    const headers = await this.apiHeaders();
    const result = this.client.get(chapterUrl.toString(), headers).then((r) => r.parseAs<ChapterDto>());
    result.catch(() => undefined); // surfaced by the await below
    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF_KEY, false);

    let unlockedChapterIds: Set<string>;
    try {
      const status = (await this.client.get(`${this.apiUrl}/user/mangas/${uuid}/v0`, headers)).parseAs<UserMangaStatusDto>();
      unlockedChapterIds = new Set([...(status.purchased_chapter_uuids ?? []), ...(status.unlocked_chapter_uuids ?? [])]);
    } catch {
      unlockedChapterIds = new Set();
    }

    return (await result).chapters
      .map((it) => {
        const now = Date.now();
        const isFree = it.free_published_date != null && tryParseInstant(it.free_published_date) <= now && (it.free_unpublished_date == null || tryParseInstant(it.free_unpublished_date) > now);
        const isLocked = !unlockedChapterIds.has(it.uuid) && !isFree;
        return [it, isLocked] as const;
      })
      .filter(([, isLocked]) => !hideLocked || !isLocked)
      .map(([chapter, isLocked]) => chapterToSChapter(chapter, slug, isLocked))
      .reverse();
  }

  override getChapterUrl(chapter: SChapter): string {
    const url = toHttpUrl(`${this.baseUrl}/${chapter.url}`);
    const slug = url.fragment;
    const chapterUuid = url.pathSegments[0];
    return `${this.baseUrl}/series/${slug}/read/${chapterUuid}`;
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUuid = toHttpUrl(`${this.baseUrl}/${chapter.url}`).pathSegments[0];
    const result = (await this.client.get(`${this.apiUrl}/chapters/${chapterUuid}/pages/v1`, await this.apiHeaders())).parseAs<PageListDto>();
    return result.data.pages.map((page, i) => {
      const highRes = maxByWidth(page.image.webp);
      // This will give the highest possible resolution even if x2400 image doesn't exist.
      return new Page(i, "", `${highResOf(highRes.url)}?drm=1`);
    });
  }

  private async apiHeaders(): Promise<Headers> {
    const token = this.client.cookieJar.loadForRequest(this.baseUrl).find((it) => it.name === "idToken")?.value;
    const headers = new Headers(this.headers);
    headers.set("azuki-organization-key", this.organizationKey);
    if (token != null) headers.set("x-user-token", token);
    return headers;
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = HIDE_LOCKED_PREF_KEY;
    p.title = "Hide Locked Chapters";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }

  // Filters
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Note: Search and active filters are applied together"), new SortFilter(), new AccessTypeFilter(), new PublisherFilter(), new GenreFilter());
  }
}
