// Port of keiyoushi/extensions-source src/en/dynasty/Dynasty.kt
import {
  ClientBuilder,
  Filter,
  FilterList,
  KeiSource,
  ListPreference,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstance,
  parseHtml,
  substringBeforeLast,
  toHttpUrl,
  type Chain,
  type Document,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import coversJson from "./assets/covers.json";
import tagsJson from "./assets/tags.json";
import {
  AUTHORS_UPPER_LIMIT,
  ANTHOLOGIES_DIR,
  ANTHOLOGY_TYPE,
  BEST_MATCH,
  CHAPTERS_DIR,
  CHAPTER_FETCH_LIMITS,
  CHAPTER_FETCH_LIMIT_PREF,
  CHAPTER_SLUG_REGEX,
  CHAPTER_TYPE,
  COVER_EXTENSIONS,
  COVER_FETCH_HOST,
  COVER_URL_FRAGMENT,
  DOUJINS_DIR,
  DOUJIN_TYPE,
  ISSUES_DIR,
  ISSUE_TYPE,
  MANGA_DIRS,
  MANGA_TYPES,
  RELEASED_ON,
  SERIES_DIR,
  SERIES_TYPE,
  SMART_SORT,
  UNICODE_REGEX,
  dateFormat,
} from "./constants.ts";
import {
  MangaEntry,
  MangaEntrySet,
  directoryOf,
  hasNextPage,
  isHeader,
  type AuthorResponse,
  type BrowseResponse,
  type ChapterItem,
  type ChapterResponse,
  type MangaChapter,
  type MangaResponse,
  type TagSuggest,
} from "./dto.ts";
import { AuthorFilter, PairingFilter, ScanlatorFilter, SortFilter, TagFilter, TypeFilter, type Tag } from "./filters.ts";

/** Kotlin's assert(cond) { message } */
function assert(cond: boolean, message: () => string): asserts cond {
  if (!cond) throw new Error(message());
}

/** Kotlin's groupBy { it.first } over pairs, insertion ordered. */
function groupByFirst(pairs: Iterable<[string, string]>): Map<string, [string, string][]> {
  const out = new Map<string, [string, string][]>();
  for (const p of pairs) {
    const list = out.get(p[0]) ?? [];
    list.push(p);
    out.set(p[0], list);
  }
  return out;
}

/** LinkedHashSet<Pair<String, String>> */
class PairSet {
  private readonly map = new Map<string, [string, string]>();
  add(p: [string, string]) {
    const k = JSON.stringify(p);
    if (!this.map.has(k)) this.map.set(k, p);
  }
  get size() {
    return this.map.size;
  }
  toList(): [string, string][] {
    return [...this.map.values()];
  }
}

export default class Dynasty extends KeiSource {
  override get supportsRelatedMangas(): boolean {
    return true;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor((chain) => this.fetchCoverUrlInterceptor(chain)).rateLimit(1, 1000, (it) => it.hash.replace(/^#/, "") !== COVER_URL_FRAGMENT);
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const homeHeaders = this.headersBuilder();
    homeHeaders.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    const document = (await this.client.get(this.baseUrl, homeHeaders)).asJsoup();

    const entries = new MangaEntrySet();
    for (const element of document.select("h4:contains(Most Popular of Past 7 Days) ~ ul.cover-list a.thumbnail")) {
      const permalink = toHttpUrl(element.absUrl("href")).pathSegments[1];
      if (permalink == null) continue;
      const [directory, resolvedPermalink] = this.resolveEntryPath(CHAPTERS_DIR, permalink);

      entries.add(new MangaEntry(this.permalinkToTitle(resolvedPermalink), `/${directory}/${resolvedPermalink}`, this.getCachedCoverUrl(directory, resolvedPermalink)));
    }

    return new MangasPage(
      entries.toList().map((it) => it.toSManga()),
      false,
    );
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const data = (await this.client.get(`${this.baseUrl}/${CHAPTERS_DIR}/added.json?page=${page - 1}`)).parseAs<BrowseResponse>();

    const entries = new MangaEntrySet();

    for (const chapter of data.chapters) {
      let isSeries = false;

      for (const tag of chapter.tags) {
        if (MANGA_TYPES.has(tag.type)) {
          const directory = directoryOf(tag.type);
          entries.add(new MangaEntry(tag.name, `/${directory}/${tag.permalink}`, this.getCachedCoverUrl(directory, tag.permalink)));

          // true if an associated series is found
          isSeries = isSeries || tag.type === SERIES_TYPE;
        }
      }

      // individual chapter if no linked series
      // mostly the case for uploaded doujins
      if (!isSeries) {
        entries.add(new MangaEntry(chapter.title, `/${CHAPTERS_DIR}/${chapter.permalink}`, this.buildChapterCoverFetchUrl(chapter.permalink)));
      }
    }

    return new MangasPage(
      entries.toList().map((it) => it.toSManga()),
      hasNextPage(data),
    );
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const typeFilter = firstInstance(filters, TypeFilter);
    if (typeFilter.checked.length === 0) {
      throw new Error("Select at least one type");
    }

    const includedSeries = typeFilter.checked.includes(SERIES_TYPE);
    const includedChapters = typeFilter.checked.includes(CHAPTER_TYPE);
    const includedDoujins = typeFilter.checked.includes(DOUJIN_TYPE);

    const resolve = async (values: string[], type: string): Promise<number[]> => {
      const out: number[] = [];
      for (const value of values) {
        let id: number | null | undefined = this.lruGet(value);
        if (id == null) {
          id = await this.fetchTagId(value, type);
          if (id != null) this.lruPut(value, id);
        }
        if (id == null) throw new Error(`Unknown ${type}: ${value}`);
        out.push(id);
      }
      return out;
    };
    const authors = await resolve(firstInstance(filters, AuthorFilter).values, "Author");
    const scanlators = await resolve(firstInstance(filters, ScanlatorFilter).values, "Scanlator");
    const pairing = await resolve(firstInstance(filters, PairingFilter).values, "Pairing");

    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder();
    url.addQueryParameter("q", query.trim());
    const sortFilter = firstInstance(filters, SortFilter);
    if (sortFilter.sort === SMART_SORT) {
      const sort = query.trim() !== "" ? BEST_MATCH : RELEASED_ON;
      url.addQueryParameter("sort", sort);
    } else {
      url.addQueryParameter("sort", sortFilter.sort);
    }
    typeFilter.checked.forEach((type) => url.addQueryParameter("classes[]", type));

    // series and doujin results are best when chapters are included
    // they will be filtered client side below
    if ((includedSeries || includedDoujins) && !includedChapters) {
      url.addQueryParameter("classes[]", CHAPTER_TYPE);
    }

    const tagFilter = firstInstance(filters, TagFilter);
    tagFilter.included.forEach((w) => url.addQueryParameter("with[]", w.id.toString()));
    tagFilter.excluded.forEach((w) => url.addQueryParameter("without[]", w.id.toString()));
    authors.forEach((author) => url.addQueryParameter("with[]", author.toString()));
    scanlators.forEach((scanlator) => url.addQueryParameter("with[]", scanlator.toString()));
    pairing.forEach((p) => url.addQueryParameter("with[]", p.toString()));
    if (page > 1) {
      url.addQueryParameter("page", page.toString());
    }

    const document = (await this.client.get(url.toString())).asJsoup();

    const parsed = this.parseSearchEntries(document);
    const entries = parsed.filter(
      (entry) =>
        !(
          (!includedSeries && entry.url.startsWith(`/${SERIES_DIR}/`)) ||
          (!includedChapters && entry.url.startsWith(`/${CHAPTERS_DIR}/`)) ||
          (!includedDoujins && entry.url.startsWith(`/${DOUJINS_DIR}/`))
        ),
    );

    // avoid "No Results found" error in case everything was filtered out from above check
    const mangas = entries.length > 0 ? entries : parsed.slice(0, 1);

    return new MangasPage(
      mangas.map((it) => it.toSManga()),
      document.selectFirst(".pagination [rel=next]") != null,
    );
  }

  private parseSearchEntries(document: Document): MangaEntry[] {
    const out: MangaEntry[] = [];
    for (const element of document.select(
      `.chapter-list a.name[href~=/(${SERIES_DIR}|${ANTHOLOGIES_DIR}|${CHAPTERS_DIR}|${DOUJINS_DIR}|${ISSUES_DIR})/], ` + `.chapter-list .doujin_tags a[href~=/${DOUJINS_DIR}/]`,
    )) {
      const segments = toHttpUrl(element.absUrl("href")).pathSegments;
      if (segments.length < 2) continue;

      let [directory, permalink] = [segments[0], segments[1]];
      let title = element.ownText();

      const [resolvedDirectory, resolvedPermalink] = this.resolveEntryPath(directory, permalink);
      if (resolvedDirectory !== directory) {
        directory = resolvedDirectory;
        permalink = resolvedPermalink;
        title = this.permalinkToTitle(resolvedPermalink);
      }

      out.push(new MangaEntry(title, `/${directory}/${permalink}`, this.getCachedCoverUrl(directory, permalink)));
    }
    return out;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const path = toHttpUrl(url.href).pathSegments;
    if (url.hostname !== toHttpUrl(this.baseUrl).host || path.length <= 1) {
      return null;
    }

    const [directory, permalink] = this.resolveEntryPath(path[0], path[1]);

    if (!MANGA_DIRS.includes(directory)) {
      return null;
    }

    return new MangaEntry(this.permalinkToTitle(permalink), `/${directory}/${permalink}`, this.getCachedCoverUrl(directory, permalink)).toSManga();
  }

  // resolves a chapter url to its linked series when possible
  private resolveEntryPath(directory: string, permalink: string): [string, string] {
    if (directory !== CHAPTERS_DIR) {
      return [directory, permalink];
    }

    const seriesPermalink = CHAPTER_SLUG_REGEX.exec(permalink)?.[1];
    if (seriesPermalink == null) return [directory, permalink];

    return [SERIES_DIR, seriesPermalink];
  }

  // LinkedHashMap with removeEldestEntry { size > 20 } (insertion order, as upstream's non-access-ordered map)
  private readonly lruCache = new Map<string, number>();
  private lruGet(key: string): number | undefined {
    return this.lruCache.get(key);
  }
  private lruPut(key: string, value: number) {
    this.lruCache.set(key, value);
    if (this.lruCache.size > 20) this.lruCache.delete(this.lruCache.keys().next().value!);
  }

  private async fetchTagId(query: string, type: string): Promise<number | null> {
    const url = `${this.baseUrl}/tags/suggest`;
    const body = new URLSearchParams();
    body.append("query", query);

    const data = (await this.client.post(url, undefined, body)).parseAs<TagSuggest[]>();

    return data.find((it) => it.type === type && it.name.trim().toLowerCase() === query)?.id ?? null;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const mangaPath = toHttpUrl(`${this.baseUrl}${manga.url}`).pathSegments;

    assert(mangaPath.length === 2 && MANGA_DIRS.includes(mangaPath[0]), () => "Migrate to Dynasty Scans to update url");

    const [directory, permalink] = [mangaPath[0], mangaPath[1]];
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment(directory).addPathSegment(`${permalink}.json`).build();
    const response = await this.client.get(url.toString());

    if (directory === CHAPTERS_DIR) {
      const data = response.parseAs<ChapterResponse>();

      return new SMangaUpdate(this.chapterDetailsParse(data), [this.individualChapterParse(data)]);
    }

    const data = response.parseAs<MangaResponse>();
    const totalPages = data.total_pages ?? 0;

    let updatedChapters: SChapter[];
    if (fetchChapters) {
      const chapterItems = [...data.taggings];
      let page = 2;
      const limit = this.chapterFetchLimit;

      while (page <= totalPages && page <= limit) {
        const pageUrl = url.newBuilder().addQueryParameter("page", page.toString()).build();

        chapterItems.push(...(await this.client.get(pageUrl.toString())).parseAs<MangaResponse>().taggings);
        page += 1;
      }

      updatedChapters = this.parseChapterList(data.type, chapterItems);
    } else {
      updatedChapters = chapters;
    }

    return new SMangaUpdate(await this.mangaDetailsParse(data), updatedChapters);
  }

  private async mangaDetailsParse(data: MangaResponse): Promise<SManga> {
    const authors = new PairSet();
    const tags = new Set<string>();
    const others = new PairSet();
    const publishingStatus = new Set<string>();

    for (const tag of data.tags) {
      switch (tag.type) {
        case "Author":
          authors.add([tag.name, tag.permalink]);
          break;
        case "General":
          tags.add(tag.name);
          break;
        case "Status":
          publishingStatus.add(tag.name);
          others.add([tag.type, tag.name]);
          break;
        default:
          others.add([tag.type, tag.name]);
      }
    }

    for (const tagging of data.taggings) {
      if (isHeader(tagging)) continue;
      for (const tag of tagging.tags) {
        switch (tag.type) {
          case "Author":
            authors.add([tag.name, tag.permalink]);
            break;
          case "General":
            tags.add(tag.name);
            break;
          case SERIES_TYPE:
          case DOUJIN_TYPE:
          case ANTHOLOGY_TYPE:
          case ISSUE_TYPE:
          case "Scanlator":
            break;
          default:
            others.add([tag.type, tag.name]);
        }
      }
    }

    const manga = SManga.create();
    manga.title = data.name;
    const authorList = authors.toList();
    manga.author =
      authorList.length > AUTHORS_UPPER_LIMIT
        ? authorList
            .slice(0, AUTHORS_UPPER_LIMIT)
            .map((it) => it[0])
            .join(", ") + "..."
        : authorList.map((it) => it[0]).join(", ");
    manga.artist = manga.author;

    let desc = "";
    const prefChapterFetchLimit = this.chapterFetchLimit;
    const totalPages = data.total_pages ?? 0;
    if (prefChapterFetchLimit < totalPages) {
      desc += `IMPORTANT: Only first ${prefChapterFetchLimit} pages of chapter list will be fetched. You can change this in extension settings.\n\n`;
    }

    if (data.description != null) {
      const fragment = parseHtml(this.host.load, this.decodeUnicode(data.description), this.baseUrl);
      fragment.select("a").remove();

      desc += fragment.wholeText().trim();
      desc += "\n\n";
    }

    desc += `Type: ${data.type}\n\n`;

    if (authorList.length > AUTHORS_UPPER_LIMIT) {
      authorList.forEach((it) => others.add(["Author", it[0]]));
    }

    for (const [type, values] of groupByFirst(others.toList())) {
      desc += `${type}:\n`;
      values.forEach((it) => (desc += `• ${it[1]}\n`));
      desc += "\n";
    }
    if (data.aliases.length > 0) {
      desc += "Aliases:\n";
      data.aliases.forEach((it) => (desc += `• ${it}\n`));
      desc += "\n";
    }
    manga.description = desc.trim();
    manga.genre = [...tags].join(", ");
    if (publishingStatus.has("Ongoing")) manga.status = SManga.ONGOING;
    else if (publishingStatus.has("Completed")) manga.status = SManga.COMPLETED;
    else if (publishingStatus.has("On Hiatus")) manga.status = SManga.ON_HIATUS;
    else if (publishingStatus.has("Licensed")) manga.status = SManga.LICENSED;
    else if (["Dropped", "Cancelled", "Not Updated", "Abandoned", "Removed"].some((it) => publishingStatus.has(it))) manga.status = SManga.CANCELLED;
    else manga.status = SManga.UNKNOWN;
    manga.thumbnail_url = (await this.resolveThumbnail(data)) ?? undefined;
    manga.memo = { authors: authorList.map((it) => it[1]) };
    return manga;
  }

  private async resolveThumbnail(data: MangaResponse): Promise<string | null> {
    const newCover = data.cover != null ? this.buildCoverUrl(data.cover) : null;
    const cachedCover = this.getCachedCoverUrl(directoryOf(data.type), data.permalink);

    if (newCover == null || cachedCover == null) {
      return (newCover != null ? await this.getHDCoverUrlIfAvailable(newCover) : null) ?? cachedCover;
    }

    // if the site's cover is the same file as the cached one, prefer the cached HD cover
    // to avoid making HEAD requests in `getHDCoverUrlIfAvailable`
    const path = toHttpUrl(cachedCover).pathSegments;
    const file = substringBeforeLast(path[path.length - 1], ".") + ".jpg";
    const tmpSDCover = toHttpUrl(cachedCover)
      .newBuilder()
      .setPathSegment(5, "medium")
      .setPathSegment(path.length - 1, file)
      .toString();

    return tmpSDCover === newCover ? cachedCover : this.getHDCoverUrlIfAvailable(newCover);
  }

  private chapterDetailsParse(data: ChapterResponse): SManga {
    const authors = new PairSet();
    const tags = new Set<string>();
    const others = new PairSet();

    for (const tag of data.tags) {
      switch (tag.type) {
        case "Author":
          authors.add([tag.name, tag.permalink]);
          break;
        case "General":
          tags.add(tag.name);
          break;
        default:
          others.add([tag.type, tag.name]);
      }
    }

    const manga = SManga.create();
    manga.title = data.title;
    manga.author = authors
      .toList()
      .map((it) => it[0])
      .join(", ");
    manga.artist = manga.author;
    let desc = `Type: ${CHAPTER_TYPE}\n\n`;
    for (const [type, values] of groupByFirst(others.toList())) {
      desc += `${type}:\n`;
      values.forEach((it) => (desc += `• ${it[1]}\n`));
      desc += "\n";
    }
    desc += `Released: ${data.released_on}`;
    manga.description = desc.trim();
    manga.genre = [...tags].join(", ");
    manga.thumbnail_url = this.buildCoverUrl(data.pages[0].url);
    manga.status = SManga.COMPLETED;
    // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: the reader's SManga has no update strategy
    manga.memo = {
      authors: authors.toList().map((it) => it[1]),
    };
    return manga;
  }

  private parseChapterList(type: string, chapters: ChapterItem[]): SChapter[] {
    let header: string | null = null;

    const chapterList: SChapter[] = [];

    for (const item of chapters) {
      if (isHeader(item)) {
        header = item.header;
        continue;
      }

      const c = item as MangaChapter;
      let chapterName = header != null ? `${header} ${c.title}` : c.title;
      if (type !== SERIES_TYPE) {
        chapterName +=
          " by " +
          c.tags
            .filter((it) => it.type === "Author")
            .map((it) => it.name)
            .join(" and ");
      }
      const chapter = SChapter.create();
      chapter.url = `/${CHAPTERS_DIR}/${c.permalink}`;
      chapter.name = chapterName;
      chapter.scanlator = c.tags
        .filter((it) => it.type === "Scanlator")
        .map((it) => it.name)
        .join(", ");
      chapter.date_upload = dateFormat.tryParseDate(c.released_on);
      chapterList.push(chapter);
    }

    return type !== DOUJIN_TYPE ? chapterList.reverse() : chapterList;
  }

  private individualChapterParse(data: ChapterResponse): SChapter {
    const chapter = SChapter.create();
    chapter.url = `/${CHAPTERS_DIR}/${data.permalink}`;
    chapter.name = "Chapter";
    chapter.scanlator = data.tags
      .filter((it) => it.type === "Scanlator")
      .map((it) => it.name)
      .join(", ");
    chapter.date_upload = dateFormat.tryParseDate(data.released_on);
    return chapter;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterPath = toHttpUrl(`${this.baseUrl}${chapter.url}`).pathSegments;

    assert(chapterPath.length === 2 && chapterPath[0] === CHAPTERS_DIR, () => "Refresh Chapter List");

    const permalink = chapterPath[1];

    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegment(CHAPTERS_DIR).addPathSegment(`${permalink}.json`).build();

    const data = (await this.client.get(url.toString())).parseAs<ChapterResponse>();

    return data.pages.map((page, index) => new Page(index, "", this.baseUrl + page.url));
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const slugs = Array.isArray(manga.memo?.authors) ? (manga.memo.authors as unknown[]).map(String) : null;
    const authorSlug = slugs?.length ? slugs[Math.floor(Math.random() * slugs.length)] : null;
    if (authorSlug == null) return [];

    const data = (await this.client.get(`${this.baseUrl}/authors/${authorSlug}.json`)).parseAs<AuthorResponse>();
    const related = new MangaEntrySet();

    for (const taggable of data.taggables) {
      const directory = directoryOf(taggable.type);
      related.add(new MangaEntry(taggable.name, `/${directory}/${taggable.permalink}`, this.getCachedCoverUrl(directory, taggable.permalink)));
    }

    for (const chapter of data.taggings) {
      const tag = chapter.tags.find((it) => MANGA_TYPES.has(it.type));
      if (tag == null) continue;
      const directory = directoryOf(tag.type);
      related.add(new MangaEntry(tag.name, `/${directory}/${tag.permalink}`, this.getCachedCoverUrl(directory, tag.permalink)));
    }

    return related.toList().map((it) => it.toSManga());
  }

  override getFilterList(_data: unknown = null): FilterList {
    const tags = tagsJson as Tag[];

    return FilterList(
      new SortFilter(),
      new TypeFilter(),
      new Filter.Header("Note: Sort and Type may not always work"),
      new Filter.Separator(),
      new TagFilter(tags),
      new AuthorFilter(),
      new ScanlatorFilter(),
      new PairingFilter(),
      new Filter.Header("Note: Author, Scanlator and Pairing filters require exact name. You can add multiple by comma (,) separation"),
    );
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const pref = new ListPreference(screen.context);
    pref.key = CHAPTER_FETCH_LIMIT_PREF;
    pref.title = "Chapters Fetch Limit";
    pref.entries = CHAPTER_FETCH_LIMITS.map((it) => `${it} pages`);
    pref.entryValues = CHAPTER_FETCH_LIMITS;
    pref.setDefaultValue(CHAPTER_FETCH_LIMITS[0]);
    pref.summary = "Limits how many pages of an entry are fetched for chapter list\nMostly applies to Doujins\n\nMore pages mean slower loading of chapter list\n\nCurrently fetching %s";
    screen.addPreference(pref);
  }

  private get chapterFetchLimit(): number {
    const it = this.preferences.getString(CHAPTER_FETCH_LIMIT_PREF, CHAPTER_FETCH_LIMITS[0]) ?? CHAPTER_FETCH_LIMITS[0];
    return it === "all" ? Number.MAX_SAFE_INTEGER : Number.parseInt(it, 10);
  }

  private get covers(): Record<string, Record<string, string>> {
    return coversJson as Record<string, Record<string, string>>;
  }

  private getCachedCoverUrl(directory: string | null, permalink: string): string | null {
    if (directory == null) return null;

    if (directory === CHAPTERS_DIR) {
      return this.buildChapterCoverFetchUrl(permalink);
    }

    const file = this.covers[directory]?.[permalink];
    if (file == null) return null;

    return this.buildCoverUrl(file);
  }

  private async getHDCoverUrlIfAvailable(coverUrl: string): Promise<string> {
    const httpUrl = toHttpUrl(coverUrl);
    const path = httpUrl.pathSegments;

    if (path.length === 7 && path[5] === "medium") {
      for (const format of COVER_EXTENSIONS) {
        const file = substringBeforeLast(path[path.length - 1], ".") + `.${format}`;
        const newUrl = httpUrl.newBuilder().setPathSegment(5, "original").setPathSegment(path.length - 1, file).build();

        if ((await this.client.head(newUrl.toString(), undefined, { ensureSuccess: false })).isSuccessful) {
          return newUrl.toString();
        }
      }
    }

    return coverUrl;
  }

  private buildCoverUrl(file: string): string {
    const path = toHttpUrl(`${this.baseUrl}${file}`).encodedPath.replace(/^\//, "");

    const b = toHttpUrl(this.baseUrl).newBuilder();
    if (!path.startsWith("system/")) {
      b.addEncodedPathSegments("system/tag_contents_covers/000");
    }
    b.addEncodedPathSegments(path);
    b.fragment(COVER_URL_FRAGMENT);
    return b.toString();
  }

  private buildChapterCoverFetchUrl(permalink: string): string {
    const u = new URL(`https://${COVER_FETCH_HOST}/`);
    u.searchParams.append("permalink", permalink);
    return u.href;
  }

  private async fetchCoverUrlInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();
    const requestUrl = new URL(request.url);

    if (requestUrl.hostname !== COVER_FETCH_HOST) {
      return chain.proceed(request);
    }

    const permalink = requestUrl.searchParams.get("permalink")!;

    const chapterUrl = toHttpUrl(this.baseUrl).newBuilder().addPathSegment(CHAPTERS_DIR).addPathSegments(`${permalink}.json`).build();

    const page = (await this.client.execute({ url: chapterUrl.toString(), method: "GET", headers: this.headers })).parseAs<ChapterResponse>().pages[0];

    const url = this.buildCoverUrl(page.url);

    return chain.proceed({ ...request, url });
  }

  private permalinkToTitle(s: string): string {
    return s
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  private decodeUnicode(input: string): string {
    return input.replace(UNICODE_REGEX, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
}
