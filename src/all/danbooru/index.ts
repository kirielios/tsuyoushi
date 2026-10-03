// Port of keiyoushi/extensions-source src/all/danbooru/Danbooru.kt (+ Dto.kt, Filters.kt)
import {
  DateTimeFormatter,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SwitchPreferenceCompat,
  isBlank,
  substringAfterLast,
  substringBeforeLast,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type ClientBuilder,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { FilterCategory, FilterDescription, FilterIsDeleted, FilterOrder, FilterTags, filterOrder } from "./filters.ts";

// Dto.kt
interface Pool {
  id: number;
  updated_at: string;
  post_ids: number[];
}
interface Post {
  file_url?: string | null;
  large_file_url?: string | null;
  preview_file_url?: string | null;
}
const bestUrl = (p: Post): string => {
  const url = p.file_url ?? p.large_file_url ?? p.preview_file_url;
  if (url == null) throw new Error("Image URL not found for post");
  return url;
};

const CHAPTER_LIST_PREF = "prefChapterList";

export default class Danbooru extends HttpSource {
  override get supportsLatest(): boolean {
    return true;
  }

  // Make image requests mimic a standard browser <img> fetch to bypass CF 403s on the CDN
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addInterceptor((request) => {
        if (new URL(request.url).hostname !== "cdn.donmai.us") return request;
        const headers = new Headers(request.headers);
        headers.delete("Cookie"); // CF flags CDN requests containing main-domain session cookies
        headers.set("Accept", "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5");
        headers.set("Sec-Fetch-Dest", "image");
        headers.set("Sec-Fetch-Mode", "no-cors");
        headers.set("Sec-Fetch-Site", "same-site");
        return { ...request, headers };
      })
      .rateLimit(2);
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.append("Referer", `${this.baseUrl}/`);
    return h;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);
  // SimpleDateFormat.parse reads a prefix ("…T12:00:00.123-05:00" -> local 12:00:00) and ignores the rest
  private tryParse(date: string | null | undefined): number {
    return this.dateFormat.tryParseDateTime(date?.slice(0, 19));
  }

  private get splitChaptersPref(): boolean {
    return this.preferences.getBoolean(CHAPTER_LIST_PREF, false);
  }

  // ============================== Popular ==============================

  protected override popularMangaRequest(page: number): Request {
    return this.searchMangaRequest(page, "", []);
  }

  protected override popularMangaParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  // ============================== Latest ===============================

  protected override latestUpdatesRequest(page: number): Request {
    return this.searchMangaRequest(page, "", [filterOrder("created_at")]);
  }

  protected override latestUpdatesParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  // ============================== Search ===============================

  // the base class would resolve a pasted URL itself; upstream handles it in fetchSearchManga
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  protected override searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    // ponytail: setEncodedQueryParameter/addEncodedQueryParameter -> plain set/add; brackets get percent-encoded, same query to the server
    const url = toHttpUrl(`${this.baseUrl}/pools/gallery`).newBuilder();

    url.setQueryParameter("search[category]", "series");

    for (const it of filters) {
      if (it instanceof FilterTags) {
        if (!isBlank(it.state)) url.addQueryParameter("search[post_tags_match]", it.state);
      } else if (it instanceof FilterDescription) {
        if (!isBlank(it.state)) url.addQueryParameter("search[description_matches]", it.state);
      } else if (it instanceof FilterIsDeleted) {
        if (it.state) url.addQueryParameter("search[is_deleted]", "true");
      } else if (it instanceof FilterCategory) {
        url.setQueryParameter("search[category]", it.selected);
      } else if (it instanceof FilterOrder) {
        if (it.selected != null) url.addQueryParameter("search[order]", it.selected);
      }
    }

    url.addQueryParameter("page", String(page));

    if (!isBlank(query)) url.addQueryParameter("search[name_contains]", query);

    return GET(url.build(), this.headers);
  }

  protected override searchMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();

    const entries = document.select("article.post-preview").map((it) => this.searchMangaFromElement(it));
    const hasNextPage = document.selectFirst("a.paginator-next") != null;

    return new MangasPage(entries, hasNextPage);
  }

  private searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = element.selectFirst(".post-preview-link")!.attr("href");
    manga.title = element.selectFirst("div.text-center")!.text();

    const srcset = element.selectFirst("source")?.attr("srcset");
    manga.thumbnail_url = srcset !== undefined ? substringBeforeLast(substringAfterLast(srcset, ",").trim(), " ").trimStart() : undefined;
    return manga;
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("http://") || query.startsWith("https://")) {
      const url = toHttpUrlOrNull(query);
      if (url != null && url.host === toHttpUrl(this.baseUrl).host) {
        const path = url.pathSegments;
        if (path.length >= 2 && path[0] === "pools") {
          const manga = SManga.create();
          manga.url = `/pools/${path[1]}`;
          return new MangasPage([await this.fetchMangaDetails(manga)], false);
        }
        throw new Error("Unsupported URL");
      }
    }
    return super.fetchSearchManga(page, query, filters);
  }

  // ============================== Details ==============================

  protected override mangaDetailsParse(response: Response): SManga {
    const manga = SManga.create();
    const document = response.asJsoup();

    manga.url = urlWithoutDomain(document.location());
    manga.title = document.selectFirst(".pool-category-series, .pool-category-collection")?.text() ?? document.selectFirst("h1")!.text();
    manga.description = document.selectFirst("#description")?.wholeText();
    manga.author = document.selectFirst("#description a[href*=artists]")?.ownText();
    manga.artist = manga.author;
    // update_strategy (ONLY_FETCH_ONCE unless posts are split into chapters): no SManga field here
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url;
  }

  // ============================= Chapters ==============================

  protected override chapterListRequest(manga: SManga): Request {
    return GET(`${this.baseUrl}${manga.url}.json`, this.headers);
  }

  protected override chapterListParse(response: Response): SChapter[] {
    const data = response.parseAs<Pool>();

    if (this.splitChaptersPref) {
      const chapters = data.post_ids
        .map((id, index) => {
          const chapter = SChapter.create();
          chapter.url = `/posts/${id}`;
          chapter.name = `Post ${index + 1}`;
          chapter.chapter_number = index + 1;
          return chapter;
        })
        .reverse();
      if (chapters.length > 0) chapters[0].date_upload = this.tryParse(data.updated_at);
      return chapters;
    }
    const chapter = SChapter.create();
    chapter.url = `/pools/${data.id}`;
    chapter.name = "Oneshot";
    chapter.date_upload = this.tryParse(data.updated_at);
    chapter.chapter_number = 0;
    return [chapter];
  }

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + chapter.url;
  }

  // =============================== Pages ===============================

  protected override pageListRequest(chapter: SChapter): Request {
    return GET(`${this.baseUrl}${chapter.url}.json`, this.headers);
  }

  protected override pageListParse(response: Response): Page[] {
    if (response.url.includes("/posts/")) {
      const data = response.parseAs<Post>();
      const u = bestUrl(data);
      const imageUrl = u.startsWith("http") ? u : `${this.baseUrl}${u}`;
      return [new Page(0, "", imageUrl)];
    }
    const data = response.parseAs<Pool>();
    return data.post_ids.map((id, index) => new Page(index, `/posts/${id}`));
  }

  protected override imageUrlRequest(page: Page): Request {
    return GET(`${this.baseUrl}${page.url}.json`, this.headers);
  }

  protected override imageUrlParse(response: Response): string {
    const url = bestUrl(response.parseAs<Post>());
    return url.startsWith("http") ? url : `${this.baseUrl}${url}`;
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return [new FilterDescription(), new FilterTags(), new FilterIsDeleted(), new FilterCategory(), new FilterOrder()];
  }

  // ============================= Utilities =============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = CHAPTER_LIST_PREF;
    p.title = "Split posts into individual chapters";
    p.summary = "Instead of showing one 'OneShot' chapter,\neach post will be it's own chapter";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }
}
