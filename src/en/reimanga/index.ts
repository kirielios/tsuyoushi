// Port of keiyoushi/extensions-source src/en/reimanga/Reimanga.kt (with Dto.kt)
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  MultiSelectListPreference,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  extractNextJs,
  firstInstance,
  firstInstanceOrNull,
  hasKeys,
  isBlank,
  parseAs,
  substringAfterLast,
  toHttpUrl,
  tryParseInstant,
  type ClientBuilder,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { GenreFilter, SortFilter, StatusFilter, TagFilter, TriStateOption } from "./filters.ts";

// --- Dto.kt
interface Tag {
  name: string;
  slug: string;
}
interface Manga {
  id: number;
  name_url: string;
  title: string;
  cover_url?: string | null;
}
interface MangaList {
  data?: Manga[];
  initialData?: Manga[]; // @JsonNames("initialData")
  pagination: { currentPage: number; totalPages: number };
}
interface MangaDetails {
  id: number;
  name_url: string;
  title: string;
  cover_url?: string | null;
  description?: string | null;
  ai_description?: string | null;
  alt_title?: string | null;
  completed?: number;
  rating?: number;
  is_adult?: number;
  genres?: Tag[];
  tags?: Tag[];
  authors?: { name: string }[];
  main_manga_id?: number | null;
  main_name_url?: string | null;
}
interface MangaPage {
  manga: MangaDetails;
}
interface ChapterList {
  manga: { id: number; name_url: string };
  chapters: { id: number; name: string; gdrive_upload_date?: string | null; updated_at?: string | null; created_at?: string | null }[];
}
interface Images {
  images: { image_url: string }[];
}
interface TagList {
  genres: Tag[];
  tags: Tag[];
}

const EXCLUDE_TAG_PREF = "pref_exclude_tag";
const MANGA_ID_MEMO = "mangaId";

const mangaToSManga = (m: Manga, baseUrl: string): SManga => {
  const manga = SManga.create();
  manga.url = `${m.name_url}-${m.id}`;
  manga.title = m.title;
  manga.thumbnail_url = m.cover_url ?? `${baseUrl}/covers/${m.id}/thumbnail.png`;
  return manga;
};

const resolvedId = (m: MangaDetails): number => (m.main_manga_id != null && m.main_manga_id > 0 ? m.main_manga_id : m.id);

/** Kotlin's Double.toString(): whole numbers keep ".0" */
const doubleText = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

function detailsToSManga(m: MangaDetails, baseUrl: string): SManga {
  const rating = m.rating ?? -1.0;
  const manga = SManga.create();
  manga.url = `${m.name_url}-${m.id}`;
  manga.title = m.title;
  manga.thumbnail_url = m.cover_url ?? `${baseUrl}/covers/${m.id}/thumbnail.png`;

  let description = "";
  if (rating > 0.0) {
    const filled = Math.min(Math.max(Math.round(rating / 2), 0), 5);
    description += "★".repeat(filled) + "☆".repeat(5 - filled);
    description += " ";
    description += doubleText(rating);
    description += "\n\n";
  }
  const desc = m.ai_description ?? m.description;
  if (desc != null && !isBlank(desc)) {
    description += desc.trim();
    description += "\n\n";
  }
  if (m.alt_title != null && !isBlank(m.alt_title)) {
    description += "Alternative Titles:\n";
    for (const title of m.alt_title.split(/[,;]/)) {
      description += "- ";
      description += title.trim();
      description += "\n";
    }
    description += "\n";
  }
  manga.description = description;
  manga.status = m.completed === 1 ? SManga.COMPLETED : SManga.ONGOING;
  manga.author = (m.authors ?? []).map((it) => it.name.trim().replace(/,$/, "").trim()).join(", ");
  const genre: string[] = [];
  if (m.is_adult === 1) genre.push("Adult");
  for (const g of m.genres ?? []) genre.push(g.name.trim());
  for (const t of m.tags ?? []) genre.push(t.name.trim());
  manga.genre = genre.join(", ");
  manga.memo = { mangaId: m.id };
  return manga;
}

function chapterPageUrl(m: MangaDetails, baseUrl: string): string {
  const mainId = m.main_manga_id;
  const mainSlug = m.main_name_url;
  return mainId != null && mainId > 0 && mainSlug != null && !isBlank(mainSlug)
    ? `${baseUrl}/manga/${mainSlug}-${mainId}`
    : `${baseUrl}/manga/${m.name_url}-${m.id}`;
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export default class Reimanga extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    // addCookie("showAdultContent" to "true"); protocols(HTTP_1_1) is the host's business
    return builder.addInterceptor((request) => {
      if (new URL(request.url).hostname === new URL(this.baseUrl).hostname) this.client.cookieJar.set(this.baseUrl, `showAdultContent=true; Domain=${new URL(this.baseUrl).hostname}; Path=/`);
      return request;
    });
  }

  private get rscHeaders() {
    const h = this.headersBuilder();
    h.set("rsc", "1");
    return h;
  }

  private readonly spaceRegex = /\s+/g;

  async getPopularManga(page: number): Promise<MangasPage> {
    if (page > 1) {
      const filters = this.getFilterList();
      firstInstance(filters, SortFilter).state = { index: 2, ascending: false };
      return this.getSearchMangaList(page - 1, "", filters);
    }

    const data = (await this.client.get(`${this.baseUrl}/api/manga/trending?limit=100`)).parseAs<Manga[]>();
    return new MangasPage(
      data.map((it) => mangaToSManga(it, this.baseUrl)),
      true,
    );
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", this.getFilterList());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/api/manga`).newBuilder();
    url.addQueryParameter("page", String(page));
    url.addQueryParameter("limit", "24");
    if (!isBlank(query)) url.addQueryParameter("search", query.trim());
    const excluded: string[] = [];
    for (const filter of filters) {
      if (filter instanceof SortFilter) {
        url.addQueryParameter("sort", filter.sort);
        url.addQueryParameter("order", filter.direction);
      } else if (filter instanceof StatusFilter) {
        const status = filter.status;
        if (status != null) url.addQueryParameter("status", status);
      } else if (filter instanceof GenreFilter) {
        const included = filter.included;
        if (included.length) url.addQueryParameter("genre", included.join(","));
        excluded.push(...filter.excluded);
      } else if (filter instanceof TagFilter) {
        const included = filter.included;
        if (included.length) url.addQueryParameter("tag", included.join(","));
        excluded.push(...filter.excluded);
      }
    }
    if (excluded.length) url.addQueryParameter("excludeGenres", excluded.join(","));

    const data = (await this.client.get(url.build().toString())).parseAs<MangaList>();
    return new MangasPage(
      (data.data ?? data.initialData ?? []).map((it) => mangaToSManga(it, this.baseUrl)),
      data.pagination.currentPage < data.pagination.totalPages,
    );
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname) return null;
    const segments = url.pathname.slice(1).split("/");
    if (segments[0] !== "manga") return null;
    const slug = segments[1];
    if (slug == null) return null;

    const m = SManga.create();
    m.url = slug;
    const manga = (await this.fetchMangaUpdate(m, [], true, false)).manga;
    manga.initialized = true;
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/manga/${chapter.url}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const memoId = manga.memo?.[MANGA_ID_MEMO];
    const requestId = typeof memoId === "number" ? memoId : Number.parseInt(substringAfterLast(manga.url, "-"), 10);

    let apiManga = (await this.client.get(`${this.baseUrl}/api/manga/${requestId}`)).parseAs<MangaPage>().manga;

    // DMCA / duplicate entries point at a main series with real metadata & chapters
    if (resolvedId(apiManga) !== requestId) {
      apiManga = (await this.client.get(`${this.baseUrl}/api/manga/${resolvedId(apiManga)}`)).parseAs<MangaPage>().manga;
    }

    let updatedManga: SManga;
    if (fetchDetails) {
      updatedManga = detailsToSManga(apiManga, this.baseUrl);
    } else {
      updatedManga = manga;
      updatedManga.memo = { [MANGA_ID_MEMO]: resolvedId(apiManga) };
    }

    const updatedChapters = fetchChapters ? this.parseChapterList(extractNextJs<ChapterList>(await this.client.get(chapterPageUrl(apiManga, this.baseUrl), this.rscHeaders), hasKeys("manga", "chapters"))) : chapters;

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  private parseChapterList(data: ChapterList | null): SChapter[] {
    if (data == null) return [];

    return data.chapters.map((chapter) => {
      const c = SChapter.create();
      c.url = `${data.manga.name_url}-${data.manga.id}/${chapter.id}`;
      c.name = chapter.name.replace(this.spaceRegex, " ").trim();
      c.date_upload = tryParseInstant(chapter.gdrive_upload_date ?? chapter.updated_at ?? chapter.created_at);
      return c;
    });
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const mangaId = substringAfterLast(manga.url, "-");
    return (await this.client.get(`${this.baseUrl}/api/manga/${mangaId}/similar`)).parseAs<Manga[]>().map((it) => mangaToSManga(it, this.baseUrl));
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const data = extractNextJs<Images>(await this.client.get(this.getChapterUrl(chapter), this.rscHeaders), hasKeys("images"));
    if (data == null) return [];

    return data.images.map((image, index) => new Page(index, "", image.image_url));
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const tagList = extractNextJs<TagList>(await this.client.get(`${this.baseUrl}/advanced-search`, this.rscHeaders), hasKeys("genres", "tags"));
    if (tagList == null) throw new Error("Failed to extract tags");
    return tagList;
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new SortFilter(), new StatusFilter()];

    const cachedTags = data as TagList | null;
    if (cachedTags != null) {
      const excluded = this.preferences.getStringSet(EXCLUDE_TAG_PREF, []);
      const option = (tag: Tag) => new TriStateOption(tag.name, tag.slug, excluded.includes(tag.slug) ? Filter.TriState.STATE_EXCLUDE : Filter.TriState.STATE_IGNORE);
      const genres = cachedTags.genres.map(option).sort(byName);
      const tags = cachedTags.tags.map(option).sort(byName);

      filters.push(new GenreFilter(genres));
      filters.push(new TagFilter(tags));
    }

    return FilterList(...filters);
  }

  // ponytail: getFilterList() has no cached tag data at this point (as upstream's first run), so the entry list stays empty until the host can pass it
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const filters = this.getFilterList();
    const tags: TriStateOption[] = [];
    const genres = firstInstanceOrNull(filters, GenreFilter)?.state;
    if (genres) tags.push(...genres);
    const tagList = firstInstanceOrNull(filters, TagFilter)?.state;
    if (tagList) tags.push(...tagList);
    tags.sort(byName);

    const p = new MultiSelectListPreference(screen.context);
    p.key = EXCLUDE_TAG_PREF;
    p.title = "Exclude Tags from Browse";
    p.entries = tags.map((it) => it.name);
    p.entryValues = tags.map((it) => it.value);
    p.setDefaultValue([]);

    const selected = this.preferences.getStringSet(EXCLUDE_TAG_PREF, []);
    const entryMap = new Map(p.entryValues.map((v, i) => [v, p.entries[i]]));
    p.summary = selected.length === 0 ? "None" : selected.map((it) => entryMap.get(it) ?? it).join(", ");
    screen.addPreference(p);
  }
}
