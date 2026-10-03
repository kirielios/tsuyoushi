// Port of keiyoushi/extensions-source src/all/namicomi/NamiComi.kt
import {
  FilterList,
  HttpException,
  KeiSource,
  ListPreference,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  toHttpUrl,
  tryParseInstant,
  type ClientBuilder,
  type Filter,
  type HttpUrl,
  type HttpUrlBuilder,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import {
  ContentRatingDto,
  StatusDto,
  TAG_TYPES,
  hasNextPage,
  ofType,
  type ChapterListDto,
  type CoverArtAttributesDto,
  type EntityAccessMapDto,
  type EntityAccessRequestDto,
  type MangaDataDto,
  type MangaDto,
  type MangaListDto,
  type OrganizationAttributesDto,
  type PageListDto,
  type PaginatedResponseDto,
  type RefreshTokenResponse,
  type TagAttributesDto,
  type TagDto,
  type Token,
} from "./dto.ts";
import { ContentRatingList, HasAvailableChaptersFilter, SortFilter, StatusList, Tag, TagList, TagsFilterMode, isUrlQueryFilter } from "./filters.ts";

export const MANGA_LIMIT = 20;
const whitespaceRegex = /\s+/g;
const COVER_QUALITY_PREF = "thumbnailQuality";
const DATA_SAVER_PREF = "dataSaver";
const SHOW_LOCKED_CHAPTERS_PREF = "showLockedChapters";

/** Filter data: kotlin.Pair serializes as {first, second}. */
type TagGroups = Record<string, { first: string; second: string }[]>;

export default class NamiComi extends KeiSource {
  private get domain() {
    return toHttpUrl(this.baseUrl).host;
  }
  private get apiUrl() {
    return `https://api.${this.domain}`;
  }
  private get cdnUrl() {
    return `https://uploads.${this.domain}`;
  }

  private get extLang(): string {
    switch (this.lang) {
      case "zh-Hans":
        return "zh-hans";
      case "zh-Hant":
        return "zh-hant";
      case "pt-BR":
        return "pt-br";
      case "pt":
        return "pt-pt";
      case "es":
        return "es-es";
      default:
        return this.lang;
    }
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3, 1000, (it) => !it.pathname.includes("/covers/"));
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = this.addCommonTypeParameters(
      this.addCommonIncludeParameters(
        toHttpUrl(`${this.apiUrl}/title/search`)
          .newBuilder()
          .addQueryParameter("order[views]", "desc")
          .addQueryParameter("availableTranslatedLanguages[]", this.extLang)
          .addQueryParameter("limit", String(MANGA_LIMIT))
          .addQueryParameter("offset", String(MANGA_LIMIT * (page - 1))),
      ),
    ).build();
    return this.mangaListParse(await this.client.get(url.toString()));
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.addCommonTypeParameters(
      this.addCommonIncludeParameters(
        toHttpUrl(`${this.apiUrl}/title/search`)
          .newBuilder()
          .addQueryParameter("order[publishedAt]", "desc")
          .addQueryParameter("availableTranslatedLanguages[]", this.extLang)
          .addQueryParameter("limit", String(MANGA_LIMIT))
          .addQueryParameter("offset", String(MANGA_LIMIT * (page - 1))),
      ),
    ).build();
    return this.mangaListParse(await this.client.get(url.toString()));
  }

  private mangaListParse(response: Response): MangasPage {
    const mangaListDto = response.parseAs<MangaListDto>();
    const mangaList = (mangaListDto.data ?? []).map((it) => this.toSManga(it));
    return new MangasPage(mangaList, hasNextPage(mangaListDto.meta));
  }

  private toSManga(dto: MangaDataDto): SManga {
    const attr = dto.attributes!;
    const extLang = this.extLang;

    const manga = SManga.create();
    manga.initialized = true;
    manga.url = dto.id!;
    manga.description = attr.description[this.lang] ?? attr.description["en"];
    manga.author = [...new Set(ofType<OrganizationAttributesDto>(dto.relationships, "organization").flatMap((it) => (it.attributes?.name != null ? [it.attributes.name] : [])))].join(", ");
    switch (attr.publicationStatus) {
      case StatusDto.ONGOING:
        manga.status = SManga.ONGOING;
        break;
      case StatusDto.CANCELLED:
        manga.status = SManga.CANCELLED;
        break;
      case StatusDto.COMPLETED:
        manga.status = SManga.COMPLETED;
        break;
      case StatusDto.HIATUS:
        manga.status = SManga.ON_HIATUS;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }

    const genres: string[] = [];
    const genresMap = new Map<string, string[]>();
    for (const tagDto of ofType<TagAttributesDto>(dto.relationships, ...TAG_TYPES)) {
      const name = tagDto.attributes!.name[extLang] ?? tagDto.attributes!.name["en"];
      const list = genresMap.get(tagDto.attributes!.group) ?? [];
      if (name != null) list.push(name);
      genresMap.set(tagDto.attributes!.group, list);
    }
    for (const g of ["content-warnings", "format", "genre", "theme"]) genres.push(...(genresMap.get(g) ?? []).sort());
    if (attr.contentRating != null && attr.contentRating !== ContentRatingDto.SAFE) genres.push(`Content Rating: ${attr.contentRating.toUpperCase()}`);
    if (attr.originalLanguage != null) {
      const name = displayLanguage(attr.originalLanguage, extLang);
      if (name) genres.push(name.charAt(0).toLocaleUpperCase(extLang) + name.slice(1));
    }
    manga.genre = genres.join(", ");

    const titleMap = attr.title;
    manga.title = titleMap[extLang] ?? titleMap["en"] ?? Object.values(titleMap)[0];

    const coverFileName = ofType<CoverArtAttributesDto>(dto.relationships, "cover_art")[0]?.attributes?.fileName;
    if (coverFileName != null) {
      const coverSuffix = this.coverQuality;
      manga.thumbnail_url = coverSuffix ? `${this.cdnUrl}/covers/${dto.id}/${coverFileName}${coverSuffix}` : `${this.cdnUrl}/covers/${dto.id}/${coverFileName}`;
    }
    return manga;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.apiUrl}/title/search`).newBuilder();
    builder.addQueryParameter("limit", String(MANGA_LIMIT));
    builder.addQueryParameter("offset", String(MANGA_LIMIT * (page - 1)));
    this.addCommonIncludeParameters(builder);
    this.addCommonTypeParameters(builder);

    const q = query.replace(whitespaceRegex, " ").trim();
    if (q) builder.addQueryParameter("title", q);

    filters.filter(isUrlQueryFilter).forEach((filter) => filter.addQueryParameter(builder, this.extLang));

    return this.mangaListParse(await this.client.get(builder.build().toString()));
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<TagGroups> {
    const groupOrder = ["content-warnings", "format", "genre", "theme"];
    const data = (await this.client.get(`${this.apiUrl}/title/tags`)).parseAs<PaginatedResponseDto<TagDto>>().data ?? [];
    const groups: TagGroups = {};
    for (const g of groupOrder) {
      const tagList = data.filter((it) => it.attributes!.group === g);
      if (!tagList.length) continue;
      groups[g] = tagList
        .map((it) => ({ first: it.id!, second: it.attributes!.name[this.extLang] ?? it.attributes!.name["en"]! }))
        .sort((a, b) => (a.second < b.second ? -1 : a.second > b.second ? 1 : 0));
    }
    return groups;
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new HasAvailableChaptersFilter(), new ContentRatingList(), new StatusList(), new SortFilter()];

    const tagGroups = data as TagGroups | null;
    if (tagGroups != null) {
      filters.push(new TagsFilterMode());
      const mapping: Record<string, string> = { "content-warnings": "Content", format: "Format", genre: "Genre", theme: "Theme" };
      for (const [group, tags] of Object.entries(tagGroups)) {
        filters.push(
          new TagList(
            mapping[group]!,
            tags.map((it) => new Tag(it.first, it.second)),
          ),
        );
      }
    }
    return filters;
  }

  protected override async getMangaByUrl(u: URL): Promise<SManga | null> {
    const url: HttpUrl = toHttpUrl(u.href);
    const segs = url.pathSegments;
    if (url.host !== this.domain || segs.length < 3 || segs[0] !== this.extLang || segs[1] !== "title") return null;

    const slug = segs[2];
    const manga = SManga.create();
    manga.url = slug;
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/${this.extLang}/title/${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const updatedManga = (async () => {
      if (!fetchDetails) return manga;
      const url = this.addCommonIncludeParameters(toHttpUrl(`${this.apiUrl}/title/${manga.url}`).newBuilder()).build();
      const data = (await this.client.get(url.toString())).parseAs<MangaDto>().data;
      return data ? this.toSManga(data) : manga;
    })();
    const updatedChapters = fetchChapters ? this.getChapterList(manga.url) : Promise.resolve(chapters);
    return new SMangaUpdate(await updatedManga, await updatedChapters);
  }

  private async getChapterList(mangaId: string): Promise<SChapter[]> {
    const firstPage = (await this.client.get(this.chapterListUrl(mangaId, 0))).parseAs<ChapterListDto>();

    const limit = firstPage.meta.limit ?? 0;
    const total = firstPage.meta.total ?? 0;

    const offsets: number[] = [];
    if (limit > 0) for (let o = limit; o < total; o += limit) offsets.push(o);
    const remainingPages = await Promise.all(offsets.map(async (offset) => (await this.client.get(this.chapterListUrl(mangaId, offset))).parseAs<ChapterListDto>()));

    const chapters = [firstPage, ...remainingPages].flatMap((it) => it.data ?? []);
    if (!chapters.length) return [];

    const chunks: string[][] = [];
    const ids = chapters.map((it) => it.id!);
    for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
    const maps = await Promise.all(
      chunks.map(async (chapterIds) => {
        const body: EntityAccessRequestDto = { entities: chapterIds.map((it) => ({ entityId: it, entityType: "chapter" })) };
        const headers = this.headers;
        headers.set("Content-Type", "application/json; charset=utf-8");
        const response = await this.client.post(`${this.apiUrl}/gating/check`, headers, JSON.stringify(body));
        return response.parseAs<EntityAccessMapDto>().data?.attributes?.map ?? {};
      }),
    );
    const accessibleChapterMap: Record<string, boolean> = Object.assign({}, ...maps);

    const showLocked = this.showLockedChapters;
    return chapters.flatMap((it) => {
      const isAccessible = accessibleChapterMap[it.id!]!;
      if (!isAccessible && !showLocked) return [];

      const attr = it.attributes!;
      const chapter = SChapter.create();
      chapter.url = it.id!;
      let name = "";
      if (!isAccessible) name += "🔒 ";
      if (attr.volume?.trim()) name += `Vol.${attr.volume}`;
      if (attr.chapter?.trim()) {
        if (name.trim()) name += " ";
        name += `Ch.${attr.chapter}`;
      }
      if (attr.name?.trim()) {
        if (name.trim()) name += " - ";
        name += attr.name;
      }
      chapter.name = name;
      chapter.date_upload = tryParseInstant(attr.publishAt);
      if (!isAccessible) chapter.memo = { needs_auth: true };
      return [chapter];
    });
  }

  private chapterListUrl(mangaId: string, offset: number): string {
    return toHttpUrl(`${this.apiUrl}/chapter`)
      .newBuilder()
      .addQueryParameter("titleId", mangaId)
      .addQueryParameter("includes[]", "organization")
      .addQueryParameter("limit", "200")
      .addQueryParameter("offset", String(offset))
      .addQueryParameter("translatedLanguages[]", this.extLang)
      .addQueryParameter("order[volume]", "desc")
      .addQueryParameter("order[chapter]", "desc")
      .build()
      .toString();
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/${this.extLang}/chapter/${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const needsAuth = chapter.memo?.needs_auth === true;
    const url = `${this.apiUrl}/images/chapter/${chapter.url}?newQualities=true`;

    let response: Response;
    if (needsAuth) response = await this.client.get(url, await this.authHeaders(), { ensureSuccess: false });
    else {
      response = await this.client.get(url, undefined, { ensureSuccess: false });
      if (response.code === 402) response = await this.client.get(url, await this.authHeaders(), { ensureSuccess: false });
    }

    if (!response.isSuccessful) {
      if (response.code === 402) throw new Error(this.token == null ? "Login via WebView" : "Purchase the chapter on the website");
      throw new HttpException(response.code, response.url);
    }

    const data = response.parseAs<PageListDto>().data;
    if (!data) return [];

    const prefix = `${data.baseUrl}/chapter/${chapter.url}/${data.hash}`;
    return this.useDataSaver ? data.low.map((it, idx) => new Page(idx, "", `${prefix}/low/${it.filename}`)) : data.source.map((it, idx) => new Page(idx, "", `${prefix}/source/${it.filename}`));
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const cover = new ListPreference(screen.context);
    cover.key = `${COVER_QUALITY_PREF}_${this.extLang}`;
    cover.title = "Cover quality";
    cover.entries = ["Original", "Medium", "Low"];
    cover.entryValues = ["", ".512.jpg", ".256.jpg"];
    cover.setDefaultValue("");
    cover.summary = "%s";
    screen.addPreference(cover);

    const dataSaver = new SwitchPreferenceCompat(screen.context);
    dataSaver.key = `${DATA_SAVER_PREF}_${this.extLang}`;
    dataSaver.title = "Data saver";
    dataSaver.summary = "Enables smaller, more compressed images";
    dataSaver.setDefaultValue(false);
    screen.addPreference(dataSaver);

    const locked = new SwitchPreferenceCompat(screen.context);
    locked.key = `${SHOW_LOCKED_CHAPTERS_PREF}_${this.extLang}`;
    locked.title = "Show locked/paywalled chapters";
    locked.summary = "Display chapters that require an account with a premium subscription";
    locked.setDefaultValue(false);
    screen.addPreference(locked);
  }

  private addCommonIncludeParameters(b: HttpUrlBuilder): HttpUrlBuilder {
    return b.addQueryParameter("includes[]", "cover_art").addQueryParameter("includes[]", "organization").addQueryParameter("includes[]", "tag").addQueryParameter("includes[]", "primary_tag").addQueryParameter("includes[]", "secondary_tag");
  }

  private addCommonTypeParameters(b: HttpUrlBuilder): HttpUrlBuilder {
    return b.addQueryParameter("types[]", "manhua").addQueryParameter("types[]", "manwha").addQueryParameter("types[]", "manga").addQueryParameter("types[]", "comic");
  }

  private get coverQuality() {
    return this.preferences.getString(`${COVER_QUALITY_PREF}_${this.extLang}`, "");
  }
  private get useDataSaver() {
    return this.preferences.getBoolean(`${DATA_SAVER_PREF}_${this.extLang}`, false);
  }
  private get showLockedChapters() {
    return this.preferences.getBoolean(`${SHOW_LOCKED_CHAPTERS_PREF}_${this.extLang}`, false);
  }

  private token: Token | null = null;
  private loginLock: Promise<void> = Promise.resolve();

  /** Mutex.withLock */
  private login(): Promise<void> {
    const run = this.loginLock.then(() => this.doLogin());
    this.loginLock = run.catch(() => undefined);
    return run;
  }

  private async doLogin() {
    // Upstream reads the token from the WebView's localStorage (getLocalStorage). There is no WebView here, so no
    // token is ever found and paywalled chapters answer "Login via WebView".
    const current = this.token;
    if (current == null) return;

    const now = Date.now();
    if (current.refresh_expires_at != null && now > current.refresh_expires_at * 1000) {
      this.cleanUpToken();
      return;
    }

    if (now + 30_000 > current.expires_at * 1000) {
      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refresh_token, scope: current.scope, client_id: "namicomi-frontend" });
      const response = await this.client.post(`https://auth.${this.domain}/realms/namicomi/protocol/openid-connect/token`, undefined, body, { ensureSuccess: false });
      if (response.isSuccessful) {
        const refresh = response.parseAs<RefreshTokenResponse>();
        const t = Math.floor(Date.now() / 1000);
        this.token = {
          ...current,
          access_token: refresh.access_token,
          refresh_token: refresh.refresh_token,
          expires_at: t + refresh.expires_in,
          refresh_expires_at: refresh.refresh_expires_in != null ? t + refresh.refresh_expires_in : null,
        };
      } else this.cleanUpToken();
    }
  }

  /** Upstream also removes the token from the WebView's localStorage; there is none here. */
  private cleanUpToken() {
    this.token = null;
  }

  private async authHeaders(): Promise<Headers> {
    await this.login();
    const headers = this.headersBuilder();
    if (this.token) headers.append("Authorization", `Bearer ${this.token.access_token}`);
    return headers;
  }
}

/** Locale.forLanguageTag(tag).getDisplayName(Locale.forLanguageTag(inLang)) */
function displayLanguage(tag: string, inLang: string): string | undefined {
  try {
    return new Intl.DisplayNames([inLang, "en"], { type: "language" }).of(tag);
  } catch {
    return undefined;
  }
}
