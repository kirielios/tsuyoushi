// Port of keiyoushi/extensions-source src/all/pixiv/Pixiv.kt
import {
  FilterList,
  HttpUrl,
  KeiSource,
  ListPreference,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  type HttpUrlBuilder,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { PixivFilters } from "./filters.ts";
import { PixivIllustration, PixivSeriesTarget, PixivUser, fromSearchQuery, fromUri, type PixivTarget } from "./link.ts";
import type {
  PixivApiResponse,
  PixivIllust,
  PixivIllustDetails,
  PixivIllustPage,
  PixivIllustPageUrls,
  PixivIllustsDetails,
  PixivNextData,
  PixivRankings,
  PixivResults,
  PixivSearchResultSeries,
  PixivSeries,
  PixivSeriesContents,
  PixivSeriesDetails,
  PixivUserInfo,
} from "./types.ts";
import { PagedBuffer, countUp, lruCached } from "./util.ts";

const PREF_IMAGE_QUALITY = "pref_image_quality";

// constants for fetchWithAdaptiveWindow
const TARGET_RESULTS = 50;
const RESULTS_PER_PAGE = 36;
const MAX_WINDOW_SIZE = 1000; // roughly 25 pages

export class PixivApiException extends Error {}

/** kotlin.Result for executeApi: failures are API-reported errors only, anything else still throws. */
type Result<T> = { ok: true; value: T } | { ok: false; error: PixivApiException };
const getOrThrow = <T>(r: Result<T>): T => {
  if (!r.ok) throw r.error;
  return r.value;
};
const getOrNull = <T>(r: Result<T>): T | null => (r.ok ? r.value : null);

const isString = (v: unknown): v is string => typeof v === "string";
const coerceIn = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const requireThat = (cond: boolean) => {
  if (!cond) throw new Error("Failed requirement.");
};

export default class Pixiv extends KeiSource {
  private apiUrl(href: string): HttpUrlBuilder {
    return HttpUrl.parse(this.baseUrl).resolve(href)!.newBuilder().addEncodedQueryParameter("lang", this.lang);
  }

  private get apiHeaders(): Headers {
    const h = this.headers;
    h.append("Accept", "application/json");
    return h;
  }

  /**
   * Sends the previously constructed API call to the Pixiv API.
   * If the server reports an error, a PixivApiException is returned as a failure.
   */
  private async executeApi<T>(builder: HttpUrlBuilder): Promise<Result<T>> {
    const resp = (await this.client.get(builder.build().toString(), this.apiHeaders, { ensureSuccess: false })).parseAs<PixivApiResponse>();
    if (resp.error) return { ok: false, error: new PixivApiException(resp.message ?? undefined) };
    return { ok: true, value: resp.body as T };
  }

  private popularMangaNextPage = 1;
  private popularMangaBuffer!: PagedBuffer<SManga>;

  async getPopularManga(page: number): Promise<MangasPage> {
    if (page === 1) {
      const seen = new Set<string>();
      this.popularMangaBuffer = new PagedBuffer<SManga>(async (p) => {
        const entries = getOrThrow(await this.executeApi<PixivRankings>(this.apiUrl("/touch/ajax/ranking/illust?mode=daily&type=manga").setQueryParameter("page", String(p)))).ranking!;
        if (!entries.length) return null;

        const detailsCall = this.apiUrl("/touch/ajax/illust/details/many");
        for (const it of entries) detailsCall.addEncodedQueryParameter("illust_ids[]", it.illustId!);

        return this.toSMangaList(getOrThrow(await this.executeApi<PixivIllustsDetails>(detailsCall)).illust_details!, seen);
      });

      this.popularMangaNextPage = 2;
    } else {
      requireThat(page === this.popularMangaNextPage++);
    }

    const mangas = await this.popularMangaBuffer.take(50);
    return new MangasPage(mangas, mangas.length > 0);
  }

  private searchNextPage = 1;
  private searchHash: string | null = null;
  private searchBuffer!: PagedBuffer<PixivIllust>;
  private searchPredicates: ((illust: PixivIllust) => boolean)[] = [];

  private userSearchNextPage = 1;
  private userSearchHash: string | null = null;
  private userSearchBuffer!: PagedBuffer<SManga>;

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const target = fromUri(HttpUrl.parse(url.href));
    return target ? this.getTargetManga(target) : null;
  }

  // Deeplink selection of specific IDs: simply fetch the single object
  private async getTargetManga(target: PixivTarget): Promise<SManga | null> {
    if (target instanceof PixivIllustration) {
      const illust = await this.getIllustCached(target.illustId);
      return illust ? this.illustToSManga(illust) : null;
    }
    if (target instanceof PixivSeriesTarget) {
      // TODO: caching!
      const series = getOrNull(await this.executeApi<PixivSeriesDetails>(this.apiUrl(`/touch/ajax/illust/series/${target.seriesId}`)))?.series;
      return series ? this.seriesToSManga(series) : null;
    }
    const user = await this.getUserCached(target.userId);
    const manga = SManga.create();
    manga.url = `/users/${target.userId}`;
    manga.title = user?.name ?? `User ${target.userId}`;
    manga.thumbnail_url = user?.imageBig ?? undefined;
    return manga;
  }

  async getSearchMangaList(page: number, query: string, filterList: FilterList): Promise<MangasPage> {
    const targetFromQuery = fromSearchQuery(query);
    if (targetFromQuery) {
      const manga = await this.getTargetManga(targetFromQuery);
      return new MangasPage(manga ? [manga] : [], false);
    }

    const filters = new PixivFilters(filterList);

    if (filters.users.trim()) {
      const hash = filters.users;
      if (hash !== this.userSearchHash || page === 1) {
        this.userSearchHash = hash;
        this.userSearchBuffer = this.makeUserSearchBuffer(filters.users);
        this.userSearchNextPage = 2;
      } else {
        requireThat(page === this.userSearchNextPage++);
      }

      const mangas = await this.userSearchBuffer.take(TARGET_RESULTS);
      return new MangasPage(mangas, mangas.length > 0);
    }

    const hash = JSON.stringify([query, filters.stateKey()]);

    if (hash !== this.searchHash || page === 1) {
      this.searchHash = hash;

      // clear predicates
      this.searchPredicates = [];

      if (query.trim()) {
        this.searchBuffer = this.makeIllustSearchBuffer(query, "s_tc", filters.order, filters.rating, filters.type, filters.dateBefore.trim() ? filters.dateBefore : null, filters.dateAfter.trim() ? filters.dateAfter : null);

        const predicates = [filters.makeTagsPredicate(), filters.makeUsersPredicate()];
        this.searchPredicates = predicates.filter((it) => it !== null);
      } else {
        this.searchBuffer = this.makeIllustSearchBuffer(
          filters.tags.trim() ? filters.tags : "漫画",
          filters.searchMode,
          filters.order,
          filters.rating,
          filters.type,
          filters.dateBefore.trim() ? filters.dateBefore : null,
          filters.dateAfter.trim() ? filters.dateAfter : null,
        );
      }

      this.searchNextPage = 2;
    } else {
      requireThat(page === this.searchNextPage++);
    }

    const filteredIllusts = this.searchPredicates.length === 0 ? await this.searchBuffer.take(TARGET_RESULTS) : // if we have a filter let's be a little smarter about how to get enough results
      await this.fetchWithAdaptiveWindow(this.searchBuffer, this.searchPredicates);

    const mangas = this.toSMangaList(filteredIllusts);
    return new MangasPage(mangas, mangas.length > 0);
  }

  // fetch with variable window size - if filter is strong and we're not getting a lot of
  // results, cast a bigger net.
  //
  // this filters post-truncate to avoid the case where a strong filter will cause the search
  // to spin forever and futilely fetch page after page trying to get enough results to return
  private async fetchWithAdaptiveWindow(buffer: PagedBuffer<PixivIllust>, predicates: ((illust: PixivIllust) => boolean)[]): Promise<PixivIllust[]> {
    const sampleIllusts = await buffer.take(RESULTS_PER_PAGE);
    const sampleFiltered = sampleIllusts.filter((illust) => predicates.every((p) => p(illust)));

    const hitRate = sampleIllusts.length ? sampleFiltered.length / sampleIllusts.length : 0.0;
    const estimatedWindow = hitRate > 0 ? coerceIn(Math.trunc(TARGET_RESULTS / hitRate), RESULTS_PER_PAGE, MAX_WINDOW_SIZE) : MAX_WINDOW_SIZE;

    // get estimated rest of unfiltered items needed to hit target results
    const remainingNeeded = Math.max(estimatedWindow - RESULTS_PER_PAGE, 0);
    const additionalIllusts = remainingNeeded > 0 ? await buffer.take(remainingNeeded) : [];

    const allIllusts = [...sampleIllusts, ...additionalIllusts];
    return allIllusts.filter((illust) => predicates.every((p) => p(illust)));
  }

  private makeIllustSearchBuffer(word: string, sMode: string, order: string | null, mode: string | null, type: string | null, dateBefore: string | null, dateAfter: string | null): PagedBuffer<PixivIllust> {
    const call = this.apiUrl("/touch/ajax/search/illusts");

    call.addQueryParameter("word", word);
    call.addEncodedQueryParameter("s_mode", sMode);
    if (type !== null) call.addEncodedQueryParameter("type", type);
    if (order !== null) call.addEncodedQueryParameter("order", order);
    if (mode !== null) call.addEncodedQueryParameter("mode", mode);
    if (dateBefore !== null) call.addEncodedQueryParameter("ecd", dateBefore);
    if (dateAfter !== null) call.addEncodedQueryParameter("scd", dateAfter);

    return new PagedBuffer<PixivIllust>(async (p) => {
      call.setQueryParameter("p", String(p));

      const illusts = getOrThrow(await this.executeApi<PixivResults>(call)).illusts!;
      if (!illusts.length) return null;

      return illusts.filter((illust) => illust.is_ad_container !== 1 && illust.type !== "2");
    });
  }

  // search by username
  private makeUserSearchBuffer(nick: string): PagedBuffer<SManga> {
    const searchUsers = HttpUrl.parse(this.baseUrl)
      .resolve("/search/users")!
      .newBuilder()
      .addQueryParameter("s_mode", "s_usr")
      .addQueryParameter("nick", nick)
      .addQueryParameter("i", "1")
      .addQueryParameter("comment", "");

    // have to use desktop User-Agent to get __NEXT_DATA__ (mobile version is SPA without embedded data)
    const searchHeaders = this.headers;
    searchHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");

    return new PagedBuffer<SManga>(async (p) => {
      searchUsers.setQueryParameter("p", String(p));

      const doc = (await this.client.get(searchUsers.build().toString(), searchHeaders, { ensureSuccess: false })).asJsoup();
      const nextDataScript = doc.selectFirst("script#__NEXT_DATA__")?.data();
      if (nextDataScript == null) return null;

      const pageProps = (JSON.parse(nextDataScript) as PixivNextData).props.pageProps;
      const userIds = pageProps.userIds ?? [];

      if (!userIds.length) return null;

      const users = pageProps.userData?.users;
      return userIds.map((userId) => {
        const user = users?.[String(userId)];
        const manga = SManga.create();
        manga.url = `/users/${userId}`;
        manga.title = user?.name ?? `User ${userId}`;
        manga.thumbnail_url = user?.imageBig ?? undefined;
        return manga;
      });
    });
  }

  // lookup directly by user id
  private async getUserIdIllusts(id: string, type: string | null): Promise<PixivIllust[]> {
    const fetchUserIllusts = this.apiUrl("/touch/ajax/user/illusts");
    if (type !== null) fetchUserIllusts.setQueryParameter("type", type);
    fetchUserIllusts.setQueryParameter("id", id);

    const list: PixivIllust[] = [];
    for (const p of countUp(1)) {
      fetchUserIllusts.setQueryParameter("p", String(p));

      const illusts = getOrThrow(await this.executeApi<PixivResults>(fetchUserIllusts)).illusts!;
      if (!illusts.length) break;

      list.push(...illusts);
    }
    return list;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return new PixivFilters().list;
  }

  private toSMangaList(illusts: PixivIllust[], seriesIdsSeen: Set<string> = new Set()): SManga[] {
    return illusts.flatMap((illust) => {
      const manga = this.illustToSManga(illust);
      if (seriesIdsSeen.has(manga.url)) return [];
      seriesIdsSeen.add(manga.url);
      return [manga];
    });
  }

  private toSearchResult(series: PixivSeries): PixivSearchResultSeries {
    return { id: series.id, title: series.title, userId: series.userId, coverImage: isString(series.coverImage) ? series.coverImage : null };
  }

  private illustToSManga(illust: PixivIllust): SManga {
    if (illust.series == null) {
      const manga = SManga.create();
      manga.url = `/artworks/${illust.id!}`;
      manga.title = illust.title ?? "(null)";
      manga.thumbnail_url = illust.url ?? undefined;
      return manga;
    }
    const series = { ...illust.series, userId: illust.series.userId ?? illust.author_details?.user_id };
    const manga = this.searchResultToSManga(series);
    manga.thumbnail_url = manga.thumbnail_url ?? illust.url ?? undefined;
    return manga;
  }
  private seriesToSManga(series: PixivSeries): SManga {
    return this.searchResultToSManga(this.toSearchResult(series));
  }
  private searchResultToSManga(series: PixivSearchResultSeries): SManga {
    const manga = SManga.create();
    manga.url = `/user/${series.userId!}/series/${series.id}`;
    manga.title = series.title ?? "(null)";
    manga.thumbnail_url = series.coverImage ?? undefined;
    return manga;
  }

  private latestMangaNextPage = 1;
  private latestMangaBuffer!: PagedBuffer<SManga>;

  async getLatestUpdates(page: number): Promise<MangasPage> {
    if (page === 1) {
      const seen = new Set<string>();
      const call = this.apiUrl("/touch/ajax/latest?type=manga");
      this.latestMangaBuffer = new PagedBuffer<SManga>(async (p) => {
        call.setQueryParameter("p", String(p));

        const illusts = getOrThrow(await this.executeApi<PixivResults>(call)).illusts!;
        if (!illusts.length) return null;

        return this.toSMangaList(
          illusts.filter((it) => it.is_ad_container !== 1),
          seen,
        );
      });

      this.latestMangaNextPage = 2;
    } else {
      requireThat(page === this.latestMangaNextPage++);
    }

    const mangas = await this.latestMangaBuffer.take(50);
    return new MangasPage(mangas, mangas.length > 0);
  }

  private readonly getIllustCached = lruCached<string, PixivIllust>(25, async (illustId) => getOrNull(await this.executeApi<PixivIllustDetails>(this.apiUrl(`/touch/ajax/illust/details?illust_id=${illustId}`)))?.illust_details ?? null);

  private readonly getUserCached = lruCached<string, PixivUserInfo>(25, async (userId) => getOrNull(await this.executeApi<PixivUserInfo>(this.apiUrl(`/ajax/user/${userId}?full=1`))));

  private readonly getSeriesIllustsCached = lruCached<string, PixivIllust[]>(25, async (seriesId) => {
    const call = this.apiUrl(`/touch/ajax/illust/series_content/${seriesId}`);
    let lastOrder = 0;

    const list: PixivIllust[] = [];
    while (true) {
      call.setQueryParameter("last_order", String(lastOrder));

      const result = await this.executeApi<PixivSeriesContents>(call);
      if (!result.ok) return null;
      const illusts = result.value.series_contents!;
      if (!illusts.length) break;

      list.push(...illusts);
      lastOrder += illusts.length;
    }
    return list;
  });

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const target = fromUri(this.baseUrl + manga.url);
    if (!target) return new SMangaUpdate(manga, fetchChapters ? [] : chapters);

    const details = fetchDetails ? this.updateMangaDetails(manga, target) : Promise.resolve(manga);
    const chapterList = fetchChapters ? this.getChapterList(target) : Promise.resolve(chapters);

    return new SMangaUpdate(...(await Promise.all([details, chapterList])));
  }

  private async updateMangaDetails(manga: SManga, target: PixivTarget): Promise<SManga> {
    if (target instanceof PixivUser) {
      const response = await this.getUserCached(target.userId);

      if (response?.name != null) {
        manga.title = response.name;
        manga.author = response.name;
        manga.artist = response.name;
      }
      if (response?.comment != null) manga.description = response.comment;
      if (response?.imageBig != null) manga.thumbnail_url = response.imageBig;
    } else if (target instanceof PixivSeriesTarget) {
      const series = getOrThrow(await this.executeApi<PixivSeriesDetails>(this.apiUrl(`/touch/ajax/illust/series/${target.seriesId}`))).series!;

      const illusts = (await this.getSeriesIllustsCached(target.seriesId))!;

      if (series.title != null) manga.title = series.title;
      if (series.caption != null) manga.description = series.caption;

      const userName = illusts[0]?.author_details?.user_name;
      if (userName != null) {
        manga.artist = userName;
        manga.author = userName;
      }

      const tags = new Set(illusts.flatMap((it) => it.tags ?? []));
      if (tags.size) manga.genre = [...tags].join(", ");

      const coverImage = isString(series.coverImage) ? series.coverImage : null;
      const thumb = coverImage ?? illusts[0]?.url;
      if (thumb != null) manga.thumbnail_url = thumb;
    } else {
      const illust = (await this.getIllustCached(target.illustId))!;

      if (illust.title != null) manga.title = illust.title;

      const userName = illust.author_details?.user_name;
      if (userName != null) {
        manga.artist = userName;
        manga.author = userName;
      }

      if (illust.comment != null) manga.description = illust.comment;
      if (illust.tags != null) manga.genre = illust.tags.join(", ");
      if (illust.url != null) manga.thumbnail_url = illust.url;
    }

    return manga;
  }

  private async getChapterList(target: PixivTarget): Promise<SChapter[]> {
    let illusts: PixivIllust[];
    if (target instanceof PixivUser) illusts = await this.getUserIdIllusts(target.userId, null);
    else if (target instanceof PixivSeriesTarget) illusts = (await this.getSeriesIllustsCached(target.seriesId))!;
    else illusts = [(await this.getIllustCached(target.illustId))!];

    return illusts.map((illust, i) => {
      const chapter = SChapter.create();
      chapter.url = `/artworks/${illust.id!}`;
      chapter.name = illust.title ?? "(null)";
      chapter.date_upload = (illust.upload_timestamp ?? 0) * 1000;
      chapter.chapter_number = illusts.length - i;
      return chapter;
    });
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const illustId = chapter.url.slice(chapter.url.lastIndexOf("/") + 1);

    return getOrThrow(await this.executeApi<PixivIllustPage[]>(this.apiUrl(`/ajax/illust/${illustId}/pages`))).map((page, i) => new Page(i, chapter.url, this.pageImageUrl(page.urls!)));
  }

  private pageImageUrl(urls: PixivIllustPageUrls): string {
    const quality = this.preferences.getString(PREF_IMAGE_QUALITY, "original")!;

    const sizeOrder = ["thumb_mini", "small", "regular", "original"] as const;
    const idx = sizeOrder.indexOf(quality as (typeof sizeOrder)[number]);
    const startIndex = idx >= 0 ? idx : sizeOrder.length - 1;

    for (const size of sizeOrder.slice(startIndex)) {
      const v = urls[size];
      if (v != null) return v;
    }
    throw new Error("Collection contains no element matching the predicate.");
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference();
    pref.key = PREF_IMAGE_QUALITY;
    pref.title = "Image quality";
    pref.entries = ["Thumb Mini", "Small", "Regular", "Original"];
    pref.entryValues = ["thumb_mini", "small", "regular", "original"];
    pref.setDefaultValue("original");
    pref.summary = "%s";
    screen.addPreference(pref);
  }
}
