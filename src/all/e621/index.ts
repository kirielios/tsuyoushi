// Port of keiyoushi/extensions-source src/all/e621/E621.kt
import {
  Base64,
  DateTimeFormatter,
  FilterList,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  toHttpUrl,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { allTags, blacklistedTags, type Pool, type Post, type PostsResponse, type UserMeResponse } from "./dto.ts";
import {
  CategoryFilter,
  ModeFilter,
  OrderFilter,
  PoolGroupFilter,
  TagGroupFilter,
  TagsFilter,
  getDefaultCategoryIndex,
  getDefaultModeIndex,
  getDefaultOrderIndex,
  getE621FilterList,
  tagFilter,
} from "./filters.ts";
import {
  accountBlacklistPref,
  apiKeyPref,
  betterDetailsPref,
  blacklistPref,
  categoryPref,
  firstEndPref,
  fullResolution,
  popularModePref,
  scoreThreshPref,
  searchModePref,
  setupE621PreferenceScreen,
  splitChaptersPref,
  usernamePref,
  whitelistPref,
} from "./preferences.ts";

const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS", Locale.ROOT);
/** SimpleDateFormat.parse reads a prefix and ignores the rest (e621 appends an offset: ".123-04:00"). */
const tryParse = (date: string): number => DATE_FORMAT.tryParseDateTime(date.slice(0, 23));

const DELETED_PLACEHOLDER = "https://placehold.co/256x256/cccccc/f66151.jpg?text=Post%20Deleted";
const BLACKLISTED_PLACEHOLDER = "https://placehold.co/256x256/cccccc/f66151.jpg?text=Post%20Blacklisted";
const NO_IMAGE_PLACEHOLDER = "https://placehold.co/256x256/cccccc/f66151.jpg?text=No%20Image";

/** Kotlin's chunked(n) */
const chunked = <T>(list: T[], n: number): T[][] => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

export default class E621 extends HttpSource {
  override get supportsLatest(): boolean {
    return true;
  }

  private cachedAccountBlacklist: string | null = null;
  private cachedAccountBlacklistCredentials: string | null = null;

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("User-Agent", `E621/1.4.${this.meta.upstreamVersionCode} Keiyoushi (https://github.com/keiyoushi/extensions-source)`);
    return h;
  }

  private apiHeaders(): Headers {
    const h = this.headersBuilder();
    const username = usernamePref(this.preferences).trim();
    const apiKey = apiKeyPref(this.preferences).trim();
    if (username.length > 0 && apiKey.length > 0) {
      // okhttp3.Credentials.basic: ISO-8859-1 by default
      h.append("Authorization", `Basic ${Base64.encode(Uint8Array.from(`${username}:${apiKey}`, (c) => c.charCodeAt(0) & 0xff))}`);
    }
    return h;
  }

  // ============================== Popular ==============================

  protected popularMangaRequest(page: number): Request {
    const searchMode = searchModePref(this.preferences);
    const category = categoryPref(this.preferences);
    const popularMode = popularModePref(this.preferences);
    const firstEnd = firstEndPref(this.preferences);

    return this.searchMangaRequest(
      page,
      "",
      FilterList(
        new ModeFilter(getDefaultModeIndex(searchMode)),
        new CategoryFilter(getDefaultCategoryIndex(category)),
        new OrderFilter(getDefaultOrderIndex("post_count")),
        new TagsFilter(`${popularMode} ${firstEnd}`.trim()),
      ),
    );
  }

  protected popularMangaParse(response: Response): Promise<MangasPage> {
    return this.searchMangaParse(response);
  }

  // ============================== Latest ===============================

  protected latestUpdatesRequest(page: number): Request {
    const searchMode = searchModePref(this.preferences);
    const category = categoryPref(this.preferences);
    const scoreThresh = scoreThreshPref(this.preferences);

    return this.searchMangaRequest(
      page,
      "",
      FilterList(
        new ModeFilter(getDefaultModeIndex(searchMode)),
        new CategoryFilter(getDefaultCategoryIndex(category)),
        new OrderFilter(getDefaultOrderIndex("created_at")),
        new TagsFilter(`order:id_desc score:>=${scoreThresh}`),
      ),
    );
  }

  protected latestUpdatesParse(response: Response): Promise<MangasPage> {
    return this.searchMangaParse(response);
  }

  // ============================== Search ===============================

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const url = toHttpUrl(this.baseUrl).newBuilder().addQueryParameter("page", `${page}`);

    let mode = "pools.json";
    let category = "";
    let order = "updated_at";
    let activeOnly = false;
    let description = "";

    const tagsMandatory = "inpool:true -video status:any";
    let orderTag = "";
    let tags = "";
    let firstPage = false;
    let endPage = false;
    let dateTag = "";

    const blacklist = blacklistPref(this.preferences);
    const whitelist = whitelistPref(this.preferences);

    for (const filter of filters) {
      if (filter instanceof ModeFilter) mode = filter.toUriPart();
      else if (filter instanceof CategoryFilter) category = filter.toUriPart();
      else if (filter instanceof OrderFilter) order = filter.toUriPart();
      else if (filter instanceof TagsFilter) tags = filter.state.trim();
      else if (filter instanceof PoolGroupFilter) {
        category = filter.getCategory();
        order = filter.getOrder();
        activeOnly = filter.getActiveOnly();
        description = filter.getDescription();
      } else if (filter instanceof TagGroupFilter) {
        orderTag = filter.getOrderTag();
        tags = filter.getTags();
        firstPage = filter.getFirstPage();
        endPage = filter.getEndPage();
        dateTag = filter.getDate();
      }
    }

    url.addPathSegment(mode);

    if (mode === "pools.json") {
      url.addQueryParameter("search[order]", order).addQueryParameter("limit", "24");
      if (category.length > 0) url.addQueryParameter("search[category]", category);
      if (activeOnly) url.addQueryParameter("search[is_active]", "true");
      if (query.length > 0) {
        const search = `*${query.trim().replaceAll(" ", "_")}*`;
        url.addQueryParameter("search[name_matches]", search);
      }
      if (description.length > 0) {
        url.addQueryParameter("search[description_matches]", description);
      }
    } else {
      tags = `${tagsMandatory} ${whitelist} ${blacklist} ${tags}`.trim();
      if (query.length > 0) {
        const search = `*${query.trim().replaceAll(" ", "_")}*`;
        tags = `${tags} ${search}`;
      }
      if (orderTag.length > 0) tags = `order:${orderTag} ${tags}`;
      if (dateTag.length > 0) tags = `date:${dateTag} ${tags}`;

      if (firstPage && endPage) tags = `${tags} ( ~first_page ~end_page )`;
      else if (firstPage) tags = `${tags} first_page`;
      else if (endPage) tags = `${tags} first_page`; // sic

      url.addQueryParameter("limit", "96");
      url.addQueryParameter("tags", tags);
    }

    return GET(url.build(), this.apiHeaders());
  }

  protected async searchMangaParse(response: Response): Promise<MangasPage> {
    switch (toHttpUrl(response.url).encodedPath) {
      case "/pools.json":
        return this.parsePoolList(response);
      case "/posts.json":
        return this.parsePostsList(response);
      default:
        return new MangasPage([], false);
    }
  }

  private parsePoolList(response: Response): Promise<MangasPage> {
    const pools = response.parseAs<Pool[]>();
    return this.parsePoolListDirect(pools, pools.length >= 24);
  }

  private async parsePostsList(response: Response): Promise<MangasPage> {
    const posts = response.parseAs<PostsResponse>().posts ?? [];
    const poolIds = posts.flatMap((it) => it.pools ?? []);
    const pools = await this.batchFetchPools(poolIds);
    return this.parsePoolListDirect(pools, posts.length >= 96);
  }

  private async parsePoolListDirect(pools: Pool[], hasNextPage: boolean): Promise<MangasPage> {
    const thumbnailMap = await this.batchFetchPostSamples(pools.map((it) => it.post_ids?.[0]).filter((it): it is number => it != null));

    const poolList = pools.map((pool) => {
      const manga = SManga.create();
      manga.url = pool.id.toString();
      manga.title = pool.name.replaceAll("_", " ");
      const first = pool.post_ids?.[0];
      manga.thumbnail_url = first != null ? thumbnailMap.get(first) : undefined;
      return manga;
    });

    return new MangasPage(poolList, hasNextPage);
  }

  // ============================== Details ==============================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/pools/${manga.url}`;
  }

  override mangaDetailsRequest(manga: SManga): Request {
    const poolId = manga.url;
    return GET(`${this.baseUrl}/pools/${poolId}.json`, this.apiHeaders());
  }

  protected async mangaDetailsParse(response: Response): Promise<SManga> {
    const pool = response.parseAs<Pool>();
    const postIds = pool.post_ids ?? [];

    const cutoff = Math.trunc(postIds.length * 0.2);
    const posts = betterDetailsPref(this.preferences) ? await this.batchFetchPosts(postIds.slice(cutoff).slice(0, 40)) : [];

    const artists = new Set(posts.flatMap((it) => it.tags?.artist ?? []));
    let rating = "";
    if (posts.some((it) => it.rating === "e")) rating = "rating:Explicit, ";
    else if (posts.some((it) => it.rating === "q")) rating = "rating:Questionable, ";
    else if (posts.some((it) => it.rating === "s")) rating = "rating:Safe, ";

    const medScore = posts.map((it) => it.score?.total ?? 0).sort((a, b) => a - b)[Math.trunc(posts.length / 2)] ?? -99999;
    const score = medScore !== -99999 ? `score:>${medScore - 1}, ` : "";

    // groupBy genre (first-seen order), then each genre's tags by descending frequency
    const grouped = new Map<string, string[]>();
    for (const post of posts) {
      const t = post.tags ?? {};
      const pairs: [string, string][] = [
        ...(t.lore ?? []).map((it): [string, string] => ["lore", it]),
        ...(t.general ?? []).map((it): [string, string] => ["general", it]),
        ...(t.species ?? []).map((it): [string, string] => ["species", it]),
        ...(t.character ?? []).map((it): [string, string] => ["character", it]),
        ...(t.copyright ?? []).map((it): [string, string] => ["copyright", it]),
      ];
      for (const [g, tag] of pairs) {
        const list = grouped.get(g) ?? [];
        list.push(tag);
        grouped.set(g, list);
      }
    }
    const tags = [...grouped].flatMap(([genre, list]) => {
      const counts = new Map<string, number>();
      for (const it of list) counts.set(it, (counts.get(it) ?? 0) + 1);
      const sorted = [...counts]
        .filter(([k]) => !tagFilter.has(k))
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k);
      switch (genre) {
        case "general":
          return sorted.slice(0, 15);
        case "copyright":
          return sorted.slice(0, 3);
        case "character":
        case "species":
        case "lore":
          return sorted.slice(0, 5);
        default:
          return [];
      }
    });

    const manga = SManga.create();
    manga.url = pool.id.toString();
    manga.title = pool.name.replaceAll("_", " ");
    const desc = pool.description ?? "";
    manga.description = desc.length > 400 ? desc.slice(0, 400) + " ..." : desc;
    manga.status = pool.is_active === true ? SManga.ONGOING : pool.is_active === false ? SManga.COMPLETED : SManga.UNKNOWN;
    manga.genre = `${rating}${score}` + tags.join(", ");
    manga.author = [...artists].filter((it) => !tagFilter.has(it)).join(", ");
    return manga;
  }

  // ============================= Chapters ==============================

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${chapter.url}`;
  }

  protected override chapterListRequest(manga: SManga): Request {
    const poolId = manga.url;
    return GET(`${this.baseUrl}/pools/${poolId}.json`, this.apiHeaders());
  }

  protected async chapterListParse(response: Response): Promise<SChapter[]> {
    const pool = response.parseAs<Pool>();
    const postIds = pool.post_ids ?? [];
    const title = pool.name.replaceAll("_", " ");

    if (postIds.length === 0) return [];

    const betterDetails = betterDetailsPref(this.preferences);
    const split = splitChaptersPref(this.preferences) !== "chapters" || betterDetails ? splitChaptersPref(this.preferences) : "merged";

    switch (split) {
      case "chapters": {
        const posts = await this.batchFetchPosts(postIds);
        const poolIds = [...new Set(posts.flatMap((it) => it.pools ?? []))];
        const subPools = new Map<number, Pool>();
        for (const it of await this.batchFetchPools(poolIds)) subPools.set(it.id, it);
        for (const [k, v] of subPools) if (!((v.post_ids ?? []).length <= postIds.length && v.id !== pool.id)) subPools.delete(k);

        const usedPools = new Map<number, Pool>();
        let n = 0;

        const chapters = posts
          .map((post): SChapter | null => {
            const isInUsedPool = (post.pools ?? []).some((it) => usedPools.has(it));
            let minPoolFirstInId = 0;
            let minSize = Infinity;
            for (const [k, v] of subPools) {
              const ids = v.post_ids ?? [];
              if (!usedPools.has(k) && ids.slice(0, 5).includes(post.id) && ids.length < minSize) {
                minSize = ids.length;
                minPoolFirstInId = k;
              }
            }

            if (isInUsedPool) return null;
            if (minPoolFirstInId > 0) {
              const subPool = subPools.get(minPoolFirstInId)!;
              let chapterTitle = subPool.name.replaceAll("_", " ");
              if (chapterTitle === title) chapterTitle = `Chapter ${n}`;

              usedPools.set(subPool.id, subPool);

              const chapter = SChapter.create();
              chapter.name = `${chapterTitle} (${(subPool.post_ids ?? []).length} pages)`;
              chapter.url = `/pools/${subPool.id}`;
              chapter.chapter_number = ++n;
              chapter.date_upload = tryParse(subPool.updated_at ?? "");
              return chapter;
            }
            const chapter = SChapter.create();
            chapter.name = `Post #${post.id}`;
            chapter.url = `/posts/${post.id}`;
            chapter.chapter_number = ++n;
            chapter.date_upload = tryParse(post.created_at ?? "");
            return chapter;
          })
          .filter((it): it is SChapter => it != null)
          .reverse();

        if (Math.trunc(chapters.length / 2) <= usedPools.size) return chapters;
        const merged = SChapter.create();
        merged.name = `​${title} (${postIds.length} pages)`;
        merged.url = `/pools/${pool.id}`;
        merged.chapter_number = 1;
        merged.date_upload = tryParse(pool.updated_at ?? "");
        return [merged];
      }
      case "posts":
        return postIds
          .map((postId, index) => {
            const chapter = SChapter.create();
            chapter.name = `Post #${postId}`;
            chapter.url = `/posts/${postId}`;
            chapter.chapter_number = index + 1;
            chapter.date_upload = tryParse(pool.updated_at ?? "");
            return chapter;
          })
          .reverse();
      case "merged": {
        const chapter = SChapter.create();
        chapter.name = `Pool #${pool.id} (${postIds.length} pages)`;
        chapter.url = `/pools/${pool.id}`;
        chapter.chapter_number = 1;
        chapter.date_upload = tryParse(pool.updated_at ?? "");
        return [chapter];
      }
      default:
        return [];
    }
  }

  // =============================== Pages ===============================

  protected override pageListRequest(chapter: SChapter): Request {
    const chapterUrl = toHttpUrl(`${this.baseUrl}${chapter.url}`);

    switch (chapterUrl.pathSegments[0]) {
      case "posts": {
        const last = chapterUrl.pathSegments[chapterUrl.pathSegments.length - 1];
        const postId = /^[+-]?\d+$/.test(last) ? Number.parseInt(last, 10) : null;
        const url = toHttpUrl(`${this.baseUrl}/posts.json`).newBuilder();
        if (postId != null) {
          url.addQueryParameter("tags", `id:${postId}`);
          url.addQueryParameter("limit", "1");
        }
        return GET(url.build(), this.apiHeaders());
      }
      case "pools": {
        const poolId = chapterUrl.pathSegments[chapterUrl.pathSegments.length - 1];
        return GET(`${this.baseUrl}/pools/${poolId}.json`, this.apiHeaders());
      }
      default:
        return GET("", this.apiHeaders());
    }
  }

  protected async pageListParse(response: Response): Promise<Page[]> {
    const url = toHttpUrl(response.url);

    const blacklist: string[][] = accountBlacklistPref(this.preferences)
      ? (await this.fetchAccountBlacklist())
          .split(/\r\n|\r|\n/)
          .map((it) => it.trim())
          .filter((it) => it.length > 0)
          .map((line) => line.split(/\s+/).filter((it) => it.length > 0))
      : [];

    if (url.encodedPath === "/posts.json") {
      const post = response.parseAs<PostsResponse>().posts?.[0];
      let imageUrl: string;
      if (post == null || this.isPostDeleted(post)) imageUrl = DELETED_PLACEHOLDER;
      else if (this.isBlacklisted(post, blacklist)) imageUrl = BLACKLISTED_PLACEHOLDER;
      else imageUrl = this.extractImageUrl(post) ?? NO_IMAGE_PLACEHOLDER;
      return [new Page(0, "", imageUrl)];
    }

    const postIds = response.parseAs<Pool>().post_ids ?? [];
    if (postIds.length === 0) return [];

    const posts = await this.batchFetchPosts(postIds);
    const postMap = new Map(posts.map((it) => [it.id, it]));

    return postIds.map((postId, index) => {
      const post = postMap.get(postId);
      let imageUrl: string;
      if (post == null || this.isPostDeleted(post)) imageUrl = DELETED_PLACEHOLDER;
      else if (this.isBlacklisted(post, blacklist)) imageUrl = BLACKLISTED_PLACEHOLDER;
      else imageUrl = this.extractImageUrl(post) ?? NO_IMAGE_PLACEHOLDER;
      return new Page(index, "", imageUrl);
    });
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("Not used");
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return getE621FilterList(categoryPref(this.preferences));
  }

  // ============================= Utilities =============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    setupE621PreferenceScreen(screen);
  }

  private isPostDeleted(post: Post): boolean {
    return post.flags?.deleted ?? false;
  }

  private isBlacklisted(post: Post, blacklist: string[][]): boolean {
    if (blacklist.length === 0) return false;
    const tags = allTags(post.tags);
    return blacklist.some((group) => group.every((tag) => tags.includes(tag)));
  }

  private extractThumbnailUrl(post: Post): string | null {
    for (const it of [post.preview?.url, post.sample?.url, post.file?.url]) {
      if (it != null && it !== "null" && it.length > 0) return it;
    }
    return null;
  }

  private extractImageUrl(post: Post): string | null {
    const sample = post.sample ?? {};
    const file = post.file?.url;
    if (file != null && (fullResolution(this.preferences) || !(sample.has ?? true) || (sample.width ?? 0) < 800 || (sample.height ?? 0) < 1200)) {
      if (file !== "null" && file.length > 0) return file;
    }

    for (const it of [sample.url, post.preview?.url]) {
      if (it != null && it !== "null" && it.length > 0) return it;
    }
    return null;
  }

  private async batchFetchPosts(postIds: number[]): Promise<Post[]> {
    if (postIds.length === 0) return [];

    const out: Post[] = [];
    for (const chunk of chunked(postIds, 200)) {
      try {
        const tagQuery = "status:all id:" + chunk.join(",");
        const url = toHttpUrl(`${this.baseUrl}/posts.json`).newBuilder().addQueryParameter("tags", tagQuery).addQueryParameter("limit", chunk.length.toString()).build();

        const data = (await this.client.execute(GET(url, this.apiHeaders()))).parseAs<PostsResponse>();

        out.push(...(data.posts ?? []).sort((a, b) => chunk.indexOf(a.id) - chunk.indexOf(b.id)));
      } catch {
        // runCatching { ... }.getOrDefault(emptyList())
      }
    }
    return out;
  }

  private async batchFetchPools(poolIds: number[]): Promise<Pool[]> {
    if (poolIds.length === 0) return [];

    const out: Pool[] = [];
    for (const chunk of chunked([...new Set(poolIds)], 100)) {
      try {
        const url = toHttpUrl(`${this.baseUrl}/pools.json`)
          .newBuilder()
          .addQueryParameter("search[order]", "id_desc")
          .addQueryParameter("search[id]", chunk.join(","))
          .addQueryParameter("limit", chunk.length.toString())
          .build();

        const data = (await this.client.execute(GET(url, this.apiHeaders()))).parseAs<Pool[]>();

        out.push(...data.sort((a, b) => chunk.indexOf(a.id) - chunk.indexOf(b.id)));
      } catch {
        // runCatching { ... }.getOrDefault(emptyList())
      }
    }
    return out;
  }

  private async batchFetchPostSamples(postIds: number[]): Promise<Map<number, string>> {
    if (postIds.length === 0) return new Map();

    const map = new Map<number, string>();
    for (const post of await this.batchFetchPosts(postIds)) {
      const url = this.extractThumbnailUrl(post);
      if (url != null) map.set(post.id, url);
    }
    return map;
  }

  private async fetchAccountBlacklist(): Promise<string> {
    if (!accountBlacklistPref(this.preferences)) return "";

    const username = usernamePref(this.preferences).trim();
    const apiKey = apiKeyPref(this.preferences).trim();
    if (username.length === 0 || apiKey.length === 0) return "";

    const credentials = `${username}:${apiKey}`;
    const cached = this.cachedAccountBlacklist;
    if (cached != null && this.cachedAccountBlacklistCredentials === credentials) {
      return cached;
    }

    let blacklist = "";
    try {
      const response = await this.client.execute(GET(`${this.baseUrl}/users/me.json`, this.apiHeaders()));
      blacklist = response.isSuccessful ? (blacklistedTags(response.parseAs<UserMeResponse>()) ?? "") : "";
    } catch {
      blacklist = "";
    }

    this.cachedAccountBlacklist = blacklist;
    this.cachedAccountBlacklistCredentials = credentials;
    return blacklist;
  }
}

