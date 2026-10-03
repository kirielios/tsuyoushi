// Port of keiyoushi/extensions-source lib-multisrc/mangataro/MangaTaro.kt
import {
  Filter,
  FilterList,
  HttpException,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ago,
  isNotBlank,
  md5 as md5Bytes,
  parseAs,
  parseHtml,
  substringAfterLast,
  toHex,
  toHttpUrl,
  urlWithoutDomain,
  type Host,
  type HttpUrl,
} from "../../sdk/index.ts";
import { getTerms, mangaUrlJson, searchPayloadJson, type BrowseManga, type ChapterList, type MangaDetails, type MangaUrl, type Pages, type SearchQueryPayload, type SearchQueryResponse } from "./dto.ts";
import { SearchWithFilters, SortFilter, StatusFilter, TagFilter, TagFilterMatch, TypeFilter, YearFilter } from "./filters.ts";

const relativeDateRegex = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/;

/** isoDateFormatter: "yyyyMMddHH" in UTC */
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 13).replace(/[-T]/g, "");

function firstInstance<T>(filters: FilterList, cls: abstract new (...args: never[]) => T): T | undefined {
  return filters.find((it) => it instanceof cls) as T | undefined;
}

/** String.unescapeHtml(): Parser.unescapeEntities until nothing changes. RCDATA (<title>) decodes entities only. */
export function unescapeHtml(load: Host["load"], s: string): string {
  let decoded = s;
  for (;;) {
    const previous = decoded;
    decoded = load(`<title>${decoded.replaceAll("</title", "&lt;/title")}</title>`)("title").text();
    if (decoded === previous) return decoded;
  }
}

export abstract class MangaTaro extends KeiSource {
  protected unescapeHtml(s: string) {
    return unescapeHtml(this.host.load, s);
  }

  private jsonHeaders() {
    const h = this.headers;
    h.set("Content-Type", "application/json; charset=utf-8");
    return h;
  }

  // ========================= Popular =========================
  override getPopularManga(page: number) {
    return this.browseManga(page, "", SortFilter.popular);
  }

  // ========================== Latest =========================
  override getLatestUpdates(page: number) {
    return this.browseManga(page, "", SortFilter.latest);
  }

  // ========================== Search =========================
  override getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (isNotBlank(query) && firstInstance(filters, SearchWithFilters)?.state === false) return this.querySearch(query);
    return this.browseManga(page, query, filters);
  }

  private async querySearch(query: string): Promise<MangasPage> {
    const body: SearchQueryPayload = { limit: 25, query: query.trim() };

    const data = (await this.client.post(`${this.baseUrl}/auth/search`, this.jsonHeaders(), JSON.stringify({ query: body.query, limit: body.limit }))).parseAs<SearchQueryResponse>().results;

    const mangas = data
      .filter((it) => it.type !== "Novel")
      .map((it) => {
        const manga = SManga.create();
        manga.url = mangaUrlJson(String(it.id), it.slug);
        manga.title = this.unescapeHtml(it.title);
        manga.thumbnail_url = it.thumbnail;
        manga.description = this.unescapeHtml(it.description);
        manga.status = it.status === "Ongoing" ? SManga.ONGOING : it.status === "Completed" ? SManga.COMPLETED : SManga.UNKNOWN;
        return manga;
      });

    return new MangasPage(mangas, false);
  }

  protected async fetchBrowsePage(page: number, query: string, filters: FilterList): Promise<BrowseManga[]> {
    const year = firstInstance(filters, YearFilter)?.selected;
    const type = firstInstance(filters, TypeFilter)?.selected;
    const status = firstInstance(filters, StatusFilter)?.selected;
    const sort = firstInstance(filters, SortFilter);
    const match = firstInstance(filters, TagFilterMatch);
    if (!sort || !match) throw new Error("No element of the required type was found in the filter list.");
    const body = searchPayloadJson({
      page,
      search: query.trim(),
      years: year != null ? [year] : [],
      genres: firstInstance(filters, TagFilter)?.checked ?? [],
      types: type != null ? [type] : [],
      statuses: status != null ? [status] : [],
      sort: sort.selected,
      genreMatchMode: match.selected,
    });

    return (await this.client.post(`${this.baseUrl}/wp-json/manga/v1/load`, this.jsonHeaders(), body)).parseAs<BrowseManga[]>();
  }

  private async browseManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const data = await this.fetchBrowsePage(page, query, filters);

    const mangas = data.filter((it) => it.type !== "Novel" && isNotBlank(it.url)).map((it) => this.browseMangaToSManga(it));

    return new MangasPage(mangas, data.length === 24);
  }

  protected browseMangaToSManga(manga: BrowseManga): SManga {
    const m = SManga.create();
    m.url = mangaUrlJson(manga.id, this.toSlug(manga.url));
    m.title = this.unescapeHtml(manga.title);
    m.thumbnail_url = manga.cover;
    m.description = this.unescapeHtml(manga.description);
    m.status = manga.status === "Ongoing" ? SManga.ONGOING : manga.status === "Completed" ? SManga.COMPLETED : SManga.UNKNOWN;
    return m;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;

    const slug = this.toSlug(url.toString());
    const document = (await this.client.get(`${this.baseUrl}/manga/${slug}`)).asJsoup();

    const body = document.selectFirst("body");
    if (!body?.hasAttr("data-manga-id")) throw new Error("NullPointerException: manga-id");
    const id = body.attr("data-manga-id");
    const statusElement = document.select(".capitalize").find((it) => {
      const text = it.text().toLowerCase();
      return text === "ongoing" || text === "completed";
    });
    const s = statusElement?.text()?.toLowerCase();
    const status = s === "ongoing" ? SManga.ONGOING : s === "completed" ? SManga.COMPLETED : SManga.UNKNOWN;

    if (document.select(".capitalize").some((it) => it.text().includes("Novel"))) {
      throw new Error("Novels are not supported");
    }

    return this.fetchMangaDetails(id, status);
  }

  // ========================= Filters =========================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new SearchWithFilters(),
      new Filter.Header("If unchecked, all filters will be ignored with search query"),
      new Filter.Header("But will give more relevant results"),
      new Filter.Separator(),
      new SortFilter(),
      new TypeFilter(),
      new StatusFilter(),
      new YearFilter(),
      new TagFilter(),
      new TagFilterMatch(),
    );
  }

  // ========================= Details =========================
  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.fetchMangaDetails(parseAs<MangaUrl>(manga.url).id, manga.status) : manga,
      fetchChapters ? this.fetchChapterList(manga) : chapters,
    ]);
    return new SMangaUpdate(details, chapterList);
  }

  private async fetchMangaDetails(id: string, status: number): Promise<SManga> {
    const url = toHttpUrl(this.baseUrl).newBuilder().addPathSegments("wp-json/wp/v2/manga").addPathSegment(id).addQueryParameter("_embed", null).build();

    // OkHttp writes a null-valued query parameter as a bare "?_embed"
    const data = (await this.client.get(url.toString().replace(/_embed=$/, "_embed"))).parseAs<MangaDetails>();

    const manga = SManga.create();
    manga.url = mangaUrlJson(String(data.id), data.slug);
    manga.title = this.unescapeHtml(data.title.rendered);
    manga.description = this.unescapeHtml(parseHtml(this.host.load, data.content.rendered, this.baseUrl).wholeText());
    const genres = new Set(getTerms(data._embedded, "post_tag"));
    if (!["Manhwa", "Manhua", "Manga"].some((it) => genres.has(it))) genres.add(data.type);
    manga.genre = [...genres].join(", ");
    manga.author = getTerms(data._embedded, "manga_author").join(", ");
    manga.status = status;
    manga.thumbnail_url = data._embedded["wp:featuredmedia"][0]?.source_url;
    manga.initialized = true;
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    const slug = parseAs<MangaUrl>(manga.url).slug;
    return `${this.baseUrl}/manga/${slug}`;
  }

  // ======================== Chapters =========================
  // The chapter token is only accepted within about a minute of the server's clock,
  // so a skewed device clock is corrected with the server's Date header
  private serverTimeOffset = 0;

  private chapterListUrl(dto: MangaUrl, offset: number): HttpUrl {
    const now = Date.now() + this.serverTimeOffset;
    const epochSecond = Math.floor(now / 1000);
    const token = this.md5(`${epochSecond}mng_ch_${isoDate(now)}`).substring(0, 16);

    const b = toHttpUrl(`${this.baseUrl}/auth/manga-chapters`).newBuilder();
    b.addQueryParameter("manga_id", dto.id);
    b.addQueryParameter("offset", String(offset));
    b.addQueryParameter("limit", "500");
    b.addQueryParameter("order", "DESC");
    b.addQueryParameter("_t", token);
    b.addQueryParameter("_ts", String(epochSecond));
    if (dto.group != null) b.addQueryParameter("group_id", String(dto.group));
    return b.build();
  }

  private async fetchChapterPage(dto: MangaUrl, offset: number): Promise<ChapterList> {
    const response = await this.client.get(this.chapterListUrl(dto, offset).toString(), undefined, { ensureSuccess: false });
    if (response.code !== 403) {
      if (!response.isSuccessful) throw new HttpException(response.code, response.url);
      return response.parseAs<ChapterList>();
    }

    const date = response.header("Date");
    const serverTime = date ? Date.parse(date) : NaN;
    if (Number.isNaN(serverTime)) throw new HttpException(403, response.url);
    this.serverTimeOffset = serverTime - Date.now();
    return (await this.client.get(this.chapterListUrl(dto, offset).toString())).parseAs<ChapterList>();
  }

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const dto = parseAs<MangaUrl>(manga.url);

    const data: ChapterList["chapters"] = [];
    let page = await this.fetchChapterPage(dto, 0);
    data.push(...page.chapters);
    // the server caps each response at 500 chapters
    while ((page.has_more ?? false) && page.chapters.length) {
      page = await this.fetchChapterPage(dto, data.length);
      data.push(...page.chapters);
    }
    this.countViews(dto.id);

    const placeholders: (string | null | undefined)[] = [null, undefined, "", "N/A", "—"];
    let hasScanlator = false;

    const chapters = data
      .filter((it) => it.language.toLowerCase() === this.lang.toLowerCase())
      .map((it) => {
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(it.url.endsWith("/") ? it.url.slice(0, -1) : it.url);
        let name = "Chapter " + it.chapter;
        if (!placeholders.includes(it.title)) name += ": " + this.unescapeHtml(it.title!);
        chapter.name = name;
        if (!placeholders.includes(it.group_name)) {
          chapter.scanlator = it.group_name!;
          hasScanlator = true;
        }
        chapter.date_upload = this.parseRelativeDate(it.date);
        return chapter;
      });

    if (hasScanlator) {
      for (const it of chapters) it.scanlator = it.scanlator ?? "​"; // Insert zero-width space
    }

    return chapters;
  }

  // ========================== Pages ==========================
  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.getChapterUrl(chapter);
    const chapterId = substringAfterLast(toHttpUrl(chapterUrl.endsWith("/") ? chapterUrl.slice(0, -1) : chapterUrl).pathSegments.at(-1)!, "-");

    const url = toHttpUrl(`${this.baseUrl}/auth/chapter-content`).newBuilder().addQueryParameter("chapter_id", chapterId).build();

    return (await this.client.get(url.toString())).parseAs<Pages>().images.map((img, idx) => new Page(idx, "", img));
  }

  // ========================= Helpers =========================
  md5(input: string): string {
    return toHex(md5Bytes(input));
  }

  private toSlug(s: string): string {
    const path = toHttpUrl(s).pathSegments.filter((it) => isNotBlank(it));
    if ((path.length === 2 && path[0] === "manga") || (path.length === 3 && path[0] === "read")) return path[1];
    throw new Error(`Expected manga or read path, got ${s}`);
  }

  private parseRelativeDate(s: string): number {
    const m = relativeDateRegex.exec(s);
    if (!m) return 0;
    const amount = Number(m[1]);
    const unit = m[2];
    if (unit === "week") return ago(amount, "weeks");
    return ago(amount, `${unit}s` as "seconds" | "minutes" | "hours" | "days" | "months" | "years");
  }

  private countViews(postId: string) {
    const url = `${this.baseUrl}/wp-json/pviews/v1/increment/`;
    this.client.enqueue({ url, method: "POST", headers: this.jsonHeaders(), body: JSON.stringify({ post_id: postId }) });
  }
}
