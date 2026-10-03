// Port of keiyoushi/extensions-source src/all/mangadex/MangaDex.kt
import {
  EditTextPreference,
  KeiSource,
  ListPreference,
  MangasPage,
  MultiSelectListPreference,
  Page,
  SwitchPreferenceCompat,
  SMangaUpdate,
  parseHtml,
  toHttpUrl,
  type ClientBuilder,
  type FilterList,
  type HttpUrl,
  type HttpUrlBuilder,
  type PreferenceScreen,
  type Response,
  type SChapter,
  type SManga,
  type SharedPreferences,
} from "../../../sdk/index.ts";
import { MDConstants, MangaDexIntl } from "./constants.ts";
import {
  firstOfType,
  hasNextPage,
  isInvalid,
  normalizeManga,
  ofType,
  type AggregateDto,
  type AggregateVolume,
  type AtHomeDto,
  type ChapterDto,
  type ChapterListDto,
  type CoverArtAttributesDto,
  type CoverArtListDto,
  type ListDto,
  type MangaAttributesDto,
  type MangaDataDto,
  type MangaDto,
  type MangaListDto,
} from "./dto.ts";
import { MangaDexHelper } from "./helper.ts";

/** Parser.unescapeEntities: textarea content is RCDATA, so only entities are decoded. */
const TEXTAREA_CLOSE = /<\/textarea/gi;

export default class MangaDex extends KeiSource {
  private get dexLang(): string {
    switch (this.lang) {
      case "zh-Hans":
        return "zh";
      case "zh-Hant":
        return "zh-hk";
      case "fil":
        return "tl";
      case "pt-BR":
        return "pt-br";
      case "es-419":
        return "es-la";
      default:
        return this.lang;
    }
  }

  private sanitized = false;
  protected override get preferences(): SharedPreferences {
    const prefs = super.preferences;
    if (!this.sanitized) {
      this.sanitized = true;
      this.sanitizeExistingUuidPrefs(prefs);
    }
    return prefs;
  }

  /** Komikku / TachiyomiSY delegation; never the case in this app. */
  private isDelegate() {
    return false;
  }

  private _helper?: MangaDexHelper;
  private get helper(): MangaDexHelper {
    return (this._helper ??= new MangaDexHelper(this.lang, (s) => parseHtml(this.host.load, `<textarea>${s.replace(TEXTAREA_CLOSE, "&lt;/textarea")}</textarea>`, this.baseUrl).selectFirst("textarea")!.wholeText()));
  }

  protected override configureHeaders(headers: Headers): Headers {
    // upstream: Android/<release> Tachiyomi/<app version> MangaDex/<extension version> Keiyoushi, and User-Agent "Tachiyomi " + http.agent
    const extraHeader = `Android/14 Tachiyomi/0.0.0 MangaDex/${this.meta.version} Keiyoushi`;
    headers.set("User-Agent", `Tachiyomi ${this.host.userAgent}`);
    headers.set("Extra", extraHeader);
    return headers;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(3);
  }

  // Popular manga section

  override async getPopularManga(page: number): Promise<MangasPage> {
    const prefs = this.preferences;
    const url = toHttpUrl(MDConstants.API_MANGA_URL)
      .newBuilder()
      .addQueryParameter("order[followedCount]", "desc")
      .addQueryParameter("availableTranslatedLanguage[]", this.dexLang)
      .addQueryParameter("limit", String(MDConstants.MANGA_LIMIT))
      .addQueryParameter("offset", this.helper.getMangaListOffset(page))
      .addQueryParameter("includes[]", MDConstants.COVER_ART);
    addQueryParameters(url, "contentRating[]", this.contentRating(prefs));
    addQueryParameters(url, "originalLanguage[]", this.originalLanguages(prefs));
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    // LocalDate.now() is the device's local date; the UTC date is used here
    url.addQueryParameter("createdAtSince", MDConstants.dateFormatterNoOffset(startOfDay.getTime() - 30 * 86_400_000));

    return this.parseMangasPage(await this.client.get(url.build().toString()));
  }

  private async parseMangasPage(response: Response): Promise<MangasPage> {
    if (response.code === 204) {
      return new MangasPage([], false);
    }

    const mangaListDto = this.parseAs<MangaListDto>(response);
    const data = (mangaListDto.data ?? []).map(normalizeManga);

    const coverSuffix = this.coverQuality(this.preferences);
    const firstVolumeCovers = (await this.fetchFirstVolumeCovers(data)) ?? {};

    const mangaList = data.map((mangaDataDto) => {
      const fileName = mangaDataDto.id in firstVolumeCovers ? firstVolumeCovers[mangaDataDto.id] : firstOfType<CoverArtAttributesDto>(mangaDataDto.relationships, MDConstants.COVER_ART)?.attributes?.fileName;
      return this.helper.createBasicManga(mangaDataDto, fileName, coverSuffix, this.dexLang, this.preferExtensionLangTitle(this.preferences));
    });

    return new MangasPage(mangaList, hasNextPage(mangaListDto));
  }

  // Latest manga section

  private latestUpdatesUrl(page: number): HttpUrl {
    const prefs = this.preferences;
    const url = toHttpUrl(MDConstants.API_CHAPTER_URL)
      .newBuilder()
      .addQueryParameter("offset", this.helper.getLatestChapterOffset(page))
      .addQueryParameter("limit", String(MDConstants.LATEST_CHAPTER_LIMIT))
      .addQueryParameter("translatedLanguage[]", this.dexLang)
      .addQueryParameter("order[publishAt]", "desc")
      .addQueryParameter("includeFutureUpdates", this.isDelegate() ? "1" : "0");
    addQueryParameters(url, "originalLanguage[]", this.originalLanguages(prefs));
    addQueryParameters(url, "contentRating[]", this.contentRating(prefs));
    addQueryParameters(url, "excludedGroups[]", union(MDConstants.defaultBlockedGroups, this.blockedGroups(prefs)));
    addQueryParameters(url, "excludedUploaders[]", this.blockedUploaders(prefs));
    url.addQueryParameter("includeFuturePublishAt", "0").addQueryParameter("includeEmptyPages", "0");
    return url.build();
  }

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.latestUpdatesParse(await this.client.get(this.latestUpdatesUrl(page).toString()));
  }

  /**
   * The API endpoint can't sort by date yet, so not implemented.
   *
   * Used by Komikku
   */
  async latestUpdatesParse(response: Response): Promise<MangasPage> {
    const chapterListDto = this.parseAs<ChapterListDto>(response);

    const mangaIds = [...new Set((chapterListDto.data ?? []).flatMap((it) => ofType(it.relationships, MDConstants.MANGA)).map((it) => it.id))];

    const mangaApiUrl = toHttpUrl(MDConstants.API_MANGA_URL).newBuilder().addQueryParameter("includes[]", MDConstants.COVER_ART).addQueryParameter("limit", String(mangaIds.length));
    addQueryParameters(mangaApiUrl, "contentRating[]", this.contentRating(this.preferences));
    addQueryParameters(mangaApiUrl, "ids[]", mangaIds);

    const mangaResponse = await this.client.get(mangaApiUrl.build().toString(), this.headers, { ensureSuccess: false });
    const mangaListDto = this.parseAs<MangaListDto>(mangaResponse);
    const data = (mangaListDto.data ?? []).map(normalizeManga);
    const firstVolumeCovers = (await this.fetchFirstVolumeCovers(data)) ?? {};

    const mangaDtoMap = new Map(data.map((it) => [it.id, it]));

    const coverSuffix = this.coverQuality(this.preferences);

    const mangaList = mangaIds
      .map((it) => mangaDtoMap.get(it))
      .filter((it) => it != null)
      .map((mangaDataDto) => {
        const fileName = mangaDataDto.id in firstVolumeCovers ? firstVolumeCovers[mangaDataDto.id] : firstOfType<CoverArtAttributesDto>(mangaDataDto.relationships, MDConstants.COVER_ART)?.attributes?.fileName;
        return this.helper.createBasicManga(mangaDataDto, fileName, coverSuffix, this.dexLang, this.preferExtensionLangTitle(this.preferences));
      });

    return new MangasPage(mangaList, hasNextPage(chapterListDto));
  }

  // Search manga section

  protected override getMangasByUrl(url: URL, page: number): Promise<MangasPage> {
    if (url.hostname.endsWith("mangadex.org")) {
      const first = url.pathname.slice(1).split("/")[0];
      const searchPrefix = first ? MDConstants.pathToSearchPrefix[first] : undefined;
      if (searchPrefix != null) {
        const match = MDConstants.uuidRegex.exec(url.toString());
        if (match != null) {
          return this.getSearchMangaList(page, searchPrefix + match[0], []);
        }
      }
    }
    return this.getSearchMangaList(page, url.toString(), []);
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith(MDConstants.PREFIX_CH_SEARCH)) {
      const mangaId = await this.getMangaIdFromChapterId(query.slice(MDConstants.PREFIX_CH_SEARCH.length));
      return this.parseMangasPage(await this.client.get(this.searchMangaUrl(page, MDConstants.PREFIX_ID_SEARCH + mangaId, filters).toString()));
    }
    if (query.startsWith(MDConstants.PREFIX_USER_SEARCH)) {
      return this.latestUpdatesParse(await this.client.get(this.searchMangaUploaderUrl(page, query.slice(MDConstants.PREFIX_USER_SEARCH.length)).toString()));
    }
    if (query.startsWith(MDConstants.PREFIX_LIST_SEARCH)) {
      return this.searchMangaListParse(await this.client.get(`${MDConstants.API_LIST_URL}/${query.slice(MDConstants.PREFIX_LIST_SEARCH.length)}`), page, filters);
    }
    return this.parseMangasPage(await this.client.get(this.searchMangaUrl(page, query.trim(), filters).toString()));
  }

  private async getMangaIdFromChapterId(id: string): Promise<string> {
    const response = await this.client.get(`${MDConstants.API_CHAPTER_URL}/${id}`, undefined, { ensureSuccess: false });

    if (!response.isSuccessful) {
      throw new Error(this.helper.intl.format("unable_to_process_chapter_request", response.code));
    }

    return firstOfType(this.parseAs<ChapterDto>(response).data!.relationships, MDConstants.MANGA)!.id;
  }

  private searchMangaUrl(page: number, query: string, filters: FilterList): HttpUrl {
    const helper = this.helper;
    if (query.startsWith(MDConstants.PREFIX_ID_SEARCH)) {
      const mangaId = query.slice(MDConstants.PREFIX_ID_SEARCH.length);

      if (!helper.containsUuid(mangaId)) {
        throw new Error(helper.intl.get("invalid_manga_id"));
      }

      const url = toHttpUrl(MDConstants.API_MANGA_URL).newBuilder().addQueryParameter("ids[]", mangaId).addQueryParameter("includes[]", MDConstants.COVER_ART);
      addQueryParameters(url, "contentRating[]", MDConstants.allContentRatings);
      return url.build();
    }

    const tempUrl = toHttpUrl(MDConstants.API_MANGA_URL)
      .newBuilder()
      .addQueryParameter("limit", String(MDConstants.MANGA_LIMIT))
      .addQueryParameter("offset", helper.getMangaListOffset(page))
      .addQueryParameter("includes[]", MDConstants.COVER_ART);

    if (query.startsWith(MDConstants.PREFIX_GRP_SEARCH)) {
      const groupId = query.slice(MDConstants.PREFIX_GRP_SEARCH.length);
      if (!helper.containsUuid(groupId)) {
        throw new Error(helper.intl.get("invalid_group_id"));
      }
      tempUrl.addQueryParameter("group", groupId);
    } else if (query.startsWith(MDConstants.PREFIX_AUTHOR_SEARCH)) {
      const authorId = query.slice(MDConstants.PREFIX_AUTHOR_SEARCH.length);
      if (!helper.containsUuid(authorId)) {
        throw new Error(helper.intl.get("invalid_author_id"));
      }
      tempUrl.addQueryParameter("authorOrArtist", authorId);
    } else {
      const actualQuery = query.replace(MDConstants.whitespaceRegex, " ");
      if (actualQuery.trim()) {
        tempUrl.addQueryParameter("title", actualQuery);
      }
    }

    return helper.mdFilters.addFiltersToUrl(tempUrl, filters.length ? filters : this.getFilterList(), this.dexLang);
  }

  private async searchMangaListParse(response: Response, page: number, filters: FilterList): Promise<MangasPage> {
    const listDto = this.parseAs<ListDto>(response);
    const listDtoFiltered = ofType(listDto.data!.relationships, MDConstants.MANGA);
    const amount = listDtoFiltered.length;

    if (amount < 1) {
      throw new Error(this.helper.intl.get("no_series_in_list"));
    }

    const minIndex = (page - 1) * MDConstants.MANGA_LIMIT;

    const tempUrl = toHttpUrl(MDConstants.API_MANGA_URL)
      .newBuilder()
      .addQueryParameter("limit", String(MDConstants.MANGA_LIMIT))
      .addQueryParameter("offset", "0")
      .addQueryParameter("includes[]", MDConstants.COVER_ART);

    const ids = [...new Set(listDtoFiltered.filter((_, i) => i >= minIndex && i < minIndex + MDConstants.MANGA_LIMIT).map((it) => it.id))];

    addQueryParameters(tempUrl, "ids[]", ids);

    const finalUrl = this.helper.mdFilters.addFiltersToUrl(tempUrl, filters.length ? filters : this.getFilterList(), this.dexLang);

    const mangaResponse = await this.client.get(finalUrl.toString(), this.headers, { ensureSuccess: false });
    const mangaList = await this.searchMangaListParseResponse(mangaResponse);

    const hasNext = amount / MDConstants.MANGA_LIMIT - (page - 1) > 1 && ids.length === MDConstants.MANGA_LIMIT;

    return new MangasPage(mangaList, hasNext);
  }

  private async searchMangaListParseResponse(response: Response): Promise<SManga[]> {
    // This check will be used as the source is doing additional requests to this
    // that are not parsed by the asObservableSuccess() method. It should throw the
    // HttpException from the app if it becomes available in a future version of extensions-lib.
    if (!response.isSuccessful) {
      throw new Error(`HTTP error ${response.code}`);
    }

    const mangaListDto = this.parseAs<MangaListDto>(response);
    const data = (mangaListDto.data ?? []).map(normalizeManga);
    const firstVolumeCovers = (await this.fetchFirstVolumeCovers(data)) ?? {};

    const coverSuffix = this.coverQuality(this.preferences);

    return data.map((mangaDataDto) => {
      const fileName = mangaDataDto.id in firstVolumeCovers ? firstVolumeCovers[mangaDataDto.id] : firstOfType<CoverArtAttributesDto>(mangaDataDto.relationships, MDConstants.COVER_ART)?.attributes?.fileName;
      return this.helper.createBasicManga(mangaDataDto, fileName, coverSuffix, this.dexLang, this.preferExtensionLangTitle(this.preferences));
    });
  }

  private searchMangaUploaderUrl(page: number, uploader: string): HttpUrl {
    const prefs = this.preferences;
    const url = toHttpUrl(MDConstants.API_CHAPTER_URL)
      .newBuilder()
      .addQueryParameter("offset", this.helper.getLatestChapterOffset(page))
      .addQueryParameter("limit", String(MDConstants.LATEST_CHAPTER_LIMIT))
      .addQueryParameter("translatedLanguage[]", this.dexLang)
      .addQueryParameter("order[publishAt]", "desc")
      .addQueryParameter("includeFutureUpdates", this.isDelegate() ? "1" : "0")
      .addQueryParameter("includeFuturePublishAt", "0")
      .addQueryParameter("includeEmptyPages", "0")
      .addQueryParameter("uploader", uploader);
    addQueryParameters(url, "originalLanguage[]", this.originalLanguages(prefs));
    addQueryParameters(url, "contentRating[]", this.contentRating(prefs));
    addQueryParameters(url, "excludedGroups[]", union(MDConstants.defaultBlockedGroups, this.blockedGroups(prefs)));
    addQueryParameters(url, "excludedUploaders[]", this.blockedUploaders(prefs));
    return url.build();
  }

  // Manga Details section

  override getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url.replace("/manga/", "/title/") + "/" + this.helper.titleToSlug(manga.title);
  }

  /**
   * Get the API endpoint URL for the entry details.
   *
   * @throws Exception if the url is the old format so people migrate
   */
  protected override async getMangaByUrl(url: URL): Promise<SManga> {
    if (!this.helper.containsUuid(url.toString())) {
      throw new Error(this.helper.intl.get("migrate_warning"));
    }

    const apiUrl = toHttpUrl(`${MDConstants.API_URL}/manga/${url.pathname.slice(1).split("/")[1]}`)
      .newBuilder()
      .addQueryParameter("includes[]", MDConstants.COVER_ART)
      .addQueryParameter("includes[]", MDConstants.AUTHOR)
      .addQueryParameter("includes[]", MDConstants.ARTIST)
      .build();
    const manga = this.parseAs<MangaDto>(await this.client.get(apiUrl.toString()));
    normalizeManga(manga.data);

    const prefs = this.preferences;
    const [chapters, firstVolumeCover] = await Promise.all([this.fetchSimpleChapterList(manga, this.dexLang), this.fetchFirstVolumeCover(manga)]);
    return this.helper.createManga(manga.data!, chapters, firstVolumeCover, this.dexLang, this.coverQuality(prefs), this.altTitlesInDesc(prefs), this.preferExtensionLangTitle(prefs), this.finalChapterInDesc(prefs));
  }

  /**
   * Get a quick-n-dirty list of the chapters to be used in determining the manga status.
   * Uses the 'aggregate' endpoint.
   */
  private async fetchSimpleChapterList(manga: MangaDto, langCode: string): Promise<Record<string, AggregateVolume>> {
    const url = `${MDConstants.API_MANGA_URL}/${manga.data!.id}/aggregate?translatedLanguage[]=${langCode}`;
    const response = await this.client.get(url, this.headers, { ensureSuccess: false });
    try {
      return this.parseAs<AggregateDto>(response).volumes ?? {};
    } catch {
      return {};
    }
  }

  /** Attempt to get the first volume cover if the setting is enabled. Uses the 'covers' endpoint. */
  private async fetchFirstVolumeCover(manga: MangaDto): Promise<string | undefined> {
    return (await this.fetchFirstVolumeCovers([manga.data!]))?.[manga.data!.id];
  }

  /** Attempt to get the first volume cover if the setting is enabled. Uses the 'covers' endpoint. */
  private async fetchFirstVolumeCovers(mangaList: MangaDataDto[]): Promise<Record<string, string> | null> {
    if (!this.tryUsingFirstVolumeCover(this.preferences) || !mangaList.length) {
      return null;
    }

    const safeMangaList = mangaList.filter((it) => it.attributes?.originalLanguage);
    const mangaMap = new Map<string, MangaAttributesDto>(safeMangaList.map((it) => [it.id, it.attributes!]));
    const locales = [...new Set(safeMangaList.map((it) => it.attributes!.originalLanguage).filter((it) => it != null))];
    const limit = Math.min(mangaMap.size * locales.length, 100);

    const apiUrl = toHttpUrl(`${MDConstants.API_URL}/cover`).newBuilder().addQueryParameter("order[volume]", "asc");
    addQueryParameters(apiUrl, "manga[]", [...mangaMap.keys()]);
    addQueryParameters(apiUrl, "locales[]", locales);
    apiUrl.addQueryParameter("limit", String(limit)).addQueryParameter("offset", "0");

    let covers;
    try {
      covers = this.parseAs<CoverArtListDto>(await this.client.get(apiUrl.build().toString(), this.headers, { ensureSuccess: false })).data ?? [];
    } catch {
      return null;
    }

    const grouped = new Map<string, typeof covers>();
    for (const c of covers) {
      const id = firstOfType(c.relationships, MDConstants.MANGA)!.id;
      grouped.set(id, [...(grouped.get(id) ?? []), c]);
    }
    const out: Record<string, string> = {};
    for (const [key, value] of grouped) {
      const found = value.find((c) => c.attributes?.locale === mangaMap.get(key)?.originalLanguage);
      const fileName = found?.attributes?.fileName;
      if (fileName) out[key] = fileName;
    }
    return out;
  }

  // Chapter list section

  /**
   * Get the API endpoint URL for the first page of chapter list.
   *
   * @throws Exception if the url is the old format so people migrate
   */
  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    if (!this.helper.containsUuid(manga.url)) {
      throw new Error(this.helper.intl.get("migrate_warning"));
    }

    const response = await this.client.get(this.paginatedChapterListUrl(this.helper.getUUIDFromUrl(manga.url), 0).toString());
    if (response.code === 204) {
      return [];
    }

    const chapterListResponse = this.parseAs<ChapterListDto>(response);

    const chapterListResults = [...(chapterListResponse.data ?? [])];

    const reqUrl = response.url;
    const beforeFeed = reqUrl.includes("/feed") ? reqUrl.slice(0, reqUrl.indexOf("/feed")) : reqUrl;
    const prefix = `${MDConstants.API_MANGA_URL}/`;
    const mangaId = beforeFeed.includes(prefix) ? beforeFeed.slice(beforeFeed.indexOf(prefix) + prefix.length) : beforeFeed;

    let offset = chapterListResponse.offset ?? 0;
    let hasNext = hasNextPage(chapterListResponse);

    // Max results that can be returned is 500 so need to make more API
    // calls if the chapter list response has a next page.
    while (hasNext) {
      offset += chapterListResponse.limit ?? 0;

      const newResponse = await this.client.get(this.paginatedChapterListUrl(mangaId, offset).toString());
      const newChapterList = this.parseAs<ChapterListDto>(newResponse);
      chapterListResults.push(...(newChapterList.data ?? []));

      hasNext = hasNextPage(newChapterList);
    }

    return chapterListResults.filter((it) => !isInvalid(it.attributes!)).map((it) => this.helper.createChapter(it));
  }

  /** Required because the chapter list API endpoint is paginated. */
  private paginatedChapterListUrl(mangaId: string, offset: number): HttpUrl {
    const prefs = this.preferences;
    const url = toHttpUrl(this.helper.getChapterEndpoint(mangaId, offset, this.dexLang)).newBuilder();
    addQueryParameters(url, "contentRating[]", MDConstants.allContentRatings);
    addQueryParameters(url, "excludedGroups[]", this.blockedGroups(prefs));
    addQueryParameters(url, "excludedUploaders[]", this.blockedUploaders(prefs));
    url.addQueryParameter("includeUnavailable", this.includeUnavailable(prefs) ? "1" : "0");
    return url.build();
  }

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + chapter.url;
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    if (!this.helper.containsUuid(chapter.url)) {
      throw new Error(this.helper.intl.get("migrate_warning"));
    }

    const chapterId = chapter.url.includes("/chapter/") ? chapter.url.slice(chapter.url.indexOf("/chapter/") + "/chapter/".length) : chapter.url;
    const url = this.forceStandardHttps(this.preferences) ? `${MDConstants.API_URL}/at-home/server/${chapterId}?forcePort443=true` : `${MDConstants.API_URL}/at-home/server/${chapterId}`;
    this.helper.mdAtHomeRefresh(url);

    const response = await this.client.get(url);
    const atHomeRequestUrl = response.url;
    const atHomeDto = this.parseAs<AtHomeDto>(response);
    const host = atHomeDto.baseUrl;

    // Have to add the time, and url to the page because pages timeout within 30 minutes now.
    const now = Date.now();

    const hash = atHomeDto.chapter.hash;
    const pageSuffix = this.useDataSaver(this.preferences) ? atHomeDto.chapter.dataSaver.map((it) => `/data-saver/${hash}/${it}`) : atHomeDto.chapter.data.map((it) => `/data/${hash}/${it}`);

    return pageSuffix.map((imgUrl, index) => {
      const mdAtHomeMetadataUrl = `${host},${atHomeRequestUrl},${now}`;
      return new Page(index, mdAtHomeMetadataUrl, imgUrl);
    });
  }

  /** Without a token refresh (imageRequest is synchronous here); getImage does the refresh. */
  override imageRequest(page: Page): { url: string; headers: Headers } {
    return { url: page.url.split(",")[0] + page.imageUrl, headers: this.headers };
  }

  /** imageRequest = helper.getValidImageUrlForPage(page, headers, client), which may refresh the MD@Home server. */
  override async getImage(page: Page): Promise<Response> {
    const url = await this.helper.getValidImageUrlForPage(page, this.headers, this.client);
    return this.client.execute({ url, method: "GET", headers: this.headers });
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const intl = this.helper.intl;
    const dexLang = this.dexLang;

    const coverQualityPref = new ListPreference(screen.context);
    coverQualityPref.key = MDConstants.getCoverQualityPreferenceKey(dexLang);
    coverQualityPref.title = intl.get("cover_quality");
    coverQualityPref.entries = MDConstants.getCoverQualityPreferenceEntries(intl);
    coverQualityPref.entryValues = MDConstants.getCoverQualityPreferenceEntryValues();
    coverQualityPref.setDefaultValue(MDConstants.getCoverQualityPreferenceDefaultValue());
    coverQualityPref.summary = "%s";

    const switchPref = (key: string, titleKey: string, def: boolean) => {
      const p = new SwitchPreferenceCompat(screen.context);
      p.key = key;
      p.title = intl.get(titleKey);
      p.summary = intl.get(`${titleKey}_summary`);
      p.setDefaultValue(def);
      return p;
    };

    const tryUsingFirstVolumeCoverPref = switchPref(MDConstants.getTryUsingFirstVolumeCoverPrefKey(dexLang), "try_using_first_volume_cover", MDConstants.TRY_USING_FIRST_VOLUME_COVER_DEFAULT);
    const dataSaverPref = switchPref(MDConstants.getDataSaverPreferenceKey(dexLang), "data_saver", false);
    const standardHttpsPortPref = switchPref(MDConstants.getStandardHttpsPreferenceKey(dexLang), "standard_https_port", false);

    const contentRatingPref = new MultiSelectListPreference(screen.context);
    contentRatingPref.key = MDConstants.getContentRatingPrefKey(dexLang);
    contentRatingPref.title = intl.get("standard_content_rating");
    contentRatingPref.summary = intl.get("standard_content_rating_summary");
    contentRatingPref.entries = [intl.get("content_rating_safe"), intl.get("content_rating_suggestive"), intl.get("content_rating_erotica"), intl.get("content_rating_pornographic")];
    contentRatingPref.entryValues = [MDConstants.CONTENT_RATING_PREF_VAL_SAFE, MDConstants.CONTENT_RATING_PREF_VAL_SUGGESTIVE, MDConstants.CONTENT_RATING_PREF_VAL_EROTICA, MDConstants.CONTENT_RATING_PREF_VAL_PORNOGRAPHIC];
    contentRatingPref.setDefaultValue(MDConstants.contentRatingPrefDefaults);

    const originalLanguagePref = new MultiSelectListPreference(screen.context);
    originalLanguagePref.key = MDConstants.getOriginalLanguagePrefKey(dexLang);
    originalLanguagePref.title = intl.get("filter_original_languages");
    originalLanguagePref.summary = intl.get("filter_original_languages_summary");
    originalLanguagePref.entries = [intl.languageDisplayName(MangaDexIntl.JAPANESE), intl.languageDisplayName(MangaDexIntl.CHINESE), intl.languageDisplayName(MangaDexIntl.KOREAN)];
    originalLanguagePref.entryValues = [MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_JAPANESE, MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_CHINESE, MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_KOREAN];
    originalLanguagePref.setDefaultValue(MDConstants.originalLanguagePrefDefaults);

    // setOnBindEditTextListener(helper::setupEditTextUuidValidator) is an Android EditText hook; not ported
    const blockedGroupsPref = new EditTextPreference(screen.context);
    blockedGroupsPref.key = MDConstants.getBlockedGroupsPrefKey(dexLang);
    blockedGroupsPref.title = intl.get("block_group_by_uuid");
    blockedGroupsPref.summary = intl.get("block_group_by_uuid_summary");

    const blockedUploaderPref = new EditTextPreference(screen.context);
    blockedUploaderPref.key = MDConstants.getBlockedUploaderPrefKey(dexLang);
    blockedUploaderPref.title = intl.get("block_uploader_by_uuid");
    blockedUploaderPref.summary = intl.get("block_uploader_by_uuid_summary");

    const altTitlesInDescPref = switchPref(MDConstants.getAltTitlesInDescPrefKey(dexLang), "alternative_titles_in_description", false);
    const preferExtensionLangTitlePref = switchPref(MDConstants.getPreferExtensionLangTitlePrefKey(dexLang), "prefer_title_in_extension_language", true);
    const finalChapterInDescPref = switchPref(MDConstants.getFinalChapterInDescPrefKey(dexLang), "final_chapter_in_description", true);
    const includeUnavailablePref = switchPref(MDConstants.getIncludeUnavailablePrefKey(dexLang), "include_unavailable", false);

    screen.addPreference(coverQualityPref);
    screen.addPreference(tryUsingFirstVolumeCoverPref);
    screen.addPreference(dataSaverPref);
    screen.addPreference(standardHttpsPortPref);
    screen.addPreference(altTitlesInDescPref);
    screen.addPreference(preferExtensionLangTitlePref);
    screen.addPreference(finalChapterInDescPref);
    screen.addPreference(includeUnavailablePref);
    screen.addPreference(contentRatingPref);
    screen.addPreference(originalLanguagePref);
    screen.addPreference(blockedGroupsPref);
    screen.addPreference(blockedUploaderPref);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return this.helper.mdFilters.getMDFilterList(this.preferences, this.dexLang, this.helper.intl);
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.getMangaByUrl(new URL(this.getMangaUrl(manga))) : Promise.resolve(manga),
      fetchChapters ? this.getChapterList(manga) : Promise.resolve(chapters),
    ]);
    return new SMangaUpdate(details, chapterList);
  }

  /** helper.json is lenient and ignores unknown keys; JSON.parse is enough here. */
  private parseAs<T>(response: Response): T {
    return response.parseAs<T>();
  }

  private contentRating(prefs: SharedPreferences) {
    return prefs.getStringSet(MDConstants.getContentRatingPrefKey(this.dexLang), MDConstants.contentRatingPrefDefaults);
  }

  private originalLanguages(prefs: SharedPreferences): string[] {
    const originalLanguages = [...prefs.getStringSet(MDConstants.getOriginalLanguagePrefKey(this.dexLang), MDConstants.originalLanguagePrefDefaults)];
    if (originalLanguages.includes(MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_CHINESE) && !originalLanguages.includes(MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_CHINESE_HK)) {
      originalLanguages.push(MDConstants.ORIGINAL_LANGUAGE_PREF_VAL_CHINESE_HK);
    }
    return originalLanguages;
  }

  private coverQuality(prefs: SharedPreferences) {
    return prefs.getString(MDConstants.getCoverQualityPreferenceKey(this.dexLang), "");
  }

  private tryUsingFirstVolumeCover(prefs: SharedPreferences) {
    return prefs.getBoolean(MDConstants.getTryUsingFirstVolumeCoverPrefKey(this.dexLang), MDConstants.TRY_USING_FIRST_VOLUME_COVER_DEFAULT);
  }

  private uuidList(value: string | null): string[] {
    return [
      ...new Set(
        (value ?? "")
          .split(",")
          .map((it) => it.trim())
          .filter((it) => it !== "")
          .sort(),
      ),
    ];
  }

  private blockedGroups(prefs: SharedPreferences) {
    return this.uuidList(prefs.getString(MDConstants.getBlockedGroupsPrefKey(this.dexLang), ""));
  }

  private blockedUploaders(prefs: SharedPreferences) {
    return this.uuidList(prefs.getString(MDConstants.getBlockedUploaderPrefKey(this.dexLang), ""));
  }

  private forceStandardHttps(prefs: SharedPreferences) {
    return prefs.getBoolean(MDConstants.getStandardHttpsPreferenceKey(this.dexLang), false);
  }

  private useDataSaver(prefs: SharedPreferences) {
    return prefs.getBoolean(MDConstants.getDataSaverPreferenceKey(this.dexLang), false);
  }

  private altTitlesInDesc(prefs: SharedPreferences) {
    return prefs.getBoolean(MDConstants.getAltTitlesInDescPrefKey(this.dexLang), false);
  }

  private preferExtensionLangTitle(prefs: SharedPreferences) {
    return prefs.getBoolean(MDConstants.getPreferExtensionLangTitlePrefKey(this.dexLang), true);
  }

  private finalChapterInDesc(prefs: SharedPreferences) {
    return prefs.getBoolean(MDConstants.getFinalChapterInDescPrefKey(this.dexLang), true);
  }

  private includeUnavailable(prefs: SharedPreferences) {
    return prefs.getBoolean(MDConstants.getIncludeUnavailablePrefKey(this.dexLang), false);
  }

  /**
   * Previous versions of the extension allowed invalid UUID values to be stored in the
   * preferences. This method clear invalid UUIDs in case the user have updated from
   * a previous version with that behaviour.
   */
  private sanitizeExistingUuidPrefs(prefs: SharedPreferences) {
    if (prefs.getBoolean(MDConstants.getHasSanitizedUuidsPrefKey(this.dexLang), false)) {
      return;
    }

    const clean = (key: string) =>
      prefs
        .getString(key, "")!
        .split(",")
        .map((it) => it.trim())
        .filter((it) => this.helper.isUuid(it))
        .join(", ");

    const blockedGroups = clean(MDConstants.getBlockedGroupsPrefKey(this.dexLang));
    const blockedUploaders = clean(MDConstants.getBlockedUploaderPrefKey(this.dexLang));

    prefs
      .edit()
      .putString(MDConstants.getBlockedGroupsPrefKey(this.dexLang), blockedGroups)
      .putString(MDConstants.getBlockedUploaderPrefKey(this.dexLang), blockedUploaders)
      .putBoolean(MDConstants.getHasSanitizedUuidsPrefKey(this.dexLang), true)
      .apply();
  }
}

/** HttpUrl.Builder.addQueryParameter(name, Set<String>?) */
function addQueryParameters(url: HttpUrlBuilder, name: string, value: string[] | null | undefined) {
  value?.forEach((it) => url.addQueryParameter(name, it));
  return url;
}

/** Kotlin Set + Set: insertion order, no duplicates */
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
