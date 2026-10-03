// Port of keiyoushi/extensions-source src/en/mangabay/Mangabay.kt
// (with Dto.kt and DleGuardResolver.kt; the resolver's WebView challenge solving is not ported: it throws upstream's message)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstance,
  firstInstanceOrNull,
  md5,
  parseAs,
  substringAfter,
  substringBefore,
  toHttpUrl,
  toJsonElement,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Response,
} from "../../../sdk/index.ts";
import { GenreFilter, SortFilter } from "./filters.ts";

// --- Dto.kt
interface ChapterListDto {
  news_id: number;
  chapters: ChapterDto[];
}
interface ChapterDto {
  id: number;
  title: string;
  date?: string;
}
const dateFormat = DateTimeFormatter.ofPattern("d.M.yyyy");
const toSChapterList = (dto: ChapterListDto): SChapter[] =>
  dto.chapters.map((c) => {
    const chapter = SChapter.create();
    chapter.url = `/reader/${dto.news_id}/${c.id}`;
    chapter.name = c.title;
    chapter.date_upload = dateFormat.tryParseDate(c.date ?? "");
    return chapter;
  });
interface PageListDto {
  images: string[];
}
interface FilterValue {
  id: number;
  value: string;
}
interface XFilters {
  filter_items: { g: { values: FilterValue[] } };
}

const MANGA_PATH_REGEX = /^\/\d+-([^/]+)\.html$/;
const FALLBACK_PREFIX = "fallback=";
const LEGACY_HOST = "read.manga-bay.org";

export default class Mangabay extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return (
      builder
        // DleGuardResolver.interceptor(baseUrl)
        .addChainInterceptor(async (chain) => {
          const originalRequest = chain.request();
          let response = await chain.proceed(originalRequest);
          // decoy spinner page with nothing to solve, served intermittently; a plain retry usually gets through
          if (response.header("X-Guard-Stall") === "1") {
            response = await chain.proceed(originalRequest);
            if (response.header("X-Guard-Stall") === "1") throw new Error("Blocked by site protection, try again later");
          }
          if (new URL(response.url).pathname.split("/")[1] !== "_c") return response;
          // upstream solves the challenge in a WebView; there is none here
          throw new Error("Open in WebView to bypass site protection");
        })
        .addChainInterceptor(async (chain) => {
          const request = chain.request();
          const response = await chain.proceed(request);
          const fragment = new URL(request.url).hash.replace(/^#/, "") || null;
          if (response.code === 404 && fragment != null && fragment.startsWith(FALLBACK_PREFIX)) {
            const fallbackUrl = fragment.slice(FALLBACK_PREFIX.length);
            return chain.proceed({ ...request, url: fallbackUrl });
          }
          return response;
        })
        // addNetworkInterceptor: the reader wants an `adult=<mangaId>` cookie
        .addChainInterceptor((chain) => {
          const request = chain.request();
          const url = new URL(request.url);
          if (!url.pathname.startsWith("/reader/")) return chain.proceed(request);
          const mangaId = decodeURIComponent(url.pathname.slice(1).split("/")[1] ?? "");
          // ponytail: set in the jar (replacing any earlier adult=) since the jar builds the Cookie header; it stays for later requests
          this.client.cookieJar.set(request.url, `adult=${mangaId}`);
          return chain.proceed(request);
        })
    );
  }

  // the guard serves a stall page for /search/ and /ComicList/ requests without an Accept header
  protected override configureHeaders(headers: Headers): Headers {
    headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8");
    return headers;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortFilter(SortFilter.POPULAR_STATE)));
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList(new SortFilter(SortFilter.LATEST_STATE)));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname && url.hostname !== LEGACY_HOST) return null;
    if (!MANGA_PATH_REGEX.test(url.pathname)) return null;
    const manga = SManga.create();
    manga.url = urlWithoutDomain(url.pathname);
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.trim() !== "") {
      const builder = toHttpUrl(this.baseUrl).newBuilder().addPathSegment("search").addPathSegment(query.trim());
      if (page > 1) {
        builder.addPathSegment("page");
        builder.addPathSegment(String(page));
        builder.addPathSegment("");
      }
      return this.parseMangaList(await this.client.get(builder.build().toString()));
    }

    const urlBuilder = toHttpUrl(this.baseUrl).newBuilder();
    const genreFilter = firstInstanceOrNull(filters, GenreFilter);
    const filtersApplied = genreFilter != null && !genreFilter.state.every((it) => it.isIgnored());

    if (filtersApplied) {
      urlBuilder.addPathSegment("ComicList");
      genreFilter.addToUrl(urlBuilder);
    } else {
      urlBuilder.addPathSegment("comix");
    }
    if (page > 1) {
      urlBuilder.addPathSegment("page");
      urlBuilder.addPathSegment(String(page));
    }
    urlBuilder.addPathSegment("");
    const url = urlBuilder.build().toString();

    const sort = firstInstance(filters, SortFilter);
    if (sort.getSort() === "") return this.parseMangaList(await this.client.get(url));

    const form = new URLSearchParams();
    form.append("dlenewssortby", sort.getSort());
    form.append("dledirection", sort.getDirection());
    if (filtersApplied) {
      form.append("set_new_sort", "dle_sort_xfilter");
      form.append("set_direction_sort", "dle_direction_xfilter");
    } else {
      form.append("set_new_sort", "dle_sort_cat_1");
      form.append("set_direction_sort", "dle_direction_cat_1");
    }
    return this.parseMangaList(await this.client.post(url, undefined, form));
  }

  private parseMangaList(response: Response): MangasPage {
    const document = response.asJsoup();
    const entries = document.select("#dle-content > a.cd").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.absUrl("href"));
      manga.title = element.selectFirst(".cd__title")!.text();
      const img = element.selectFirst(".cd__ph img");
      const miniUrl = img ? img.absUrl("data-src") || img.absUrl("data-adult-src") || null : null;
      const hdUrl = this.hdPosterUrl(manga.url);
      manga.thumbnail_url = hdUrl == null ? (miniUrl ?? undefined) : miniUrl == null ? hdUrl : `${hdUrl}#${FALLBACK_PREFIX}${miniUrl}`;
      return manga;
    });
    const hasNextPage = document.selectFirst("div.pagination__pages")?.children().last()?.tagName() === "a";
    return new MangasPage(entries, hasNextPage);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const details = this.mangaDetailsParse(document);
    details.url = manga.url;
    const data = this.extractData(document);
    return new SMangaUpdate(details, data != null ? toSChapterList(parseAs<ChapterListDto>(data)) : []);
  }

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst("article.page header.page__header h1")!.text();
    manga.thumbnail_url = document.selectFirst("div.page__poster img")?.absUrl("src");

    const altTitles = (document.selectFirst("header.page__header > .page__alt")?.text().split(/\s*[;,/·]\s*/) ?? []).map((it) => it.trim()).filter((it) => it !== "");
    const pageText = document.selectFirst("div.page__desc-text")?.text();
    let description = "";
    if (pageText != null) description += pageText;
    if (altTitles.length) {
      if (pageText != null) description += "\n\n";
      description += "Alternative titles:";
      for (const t of altTitles) description += `\n- ${t}`;
    }
    manga.description = description || undefined;

    manga.author = this.infoValue(document, "Author") ?? undefined;
    manga.artist = this.infoValue(document, "Artist") ?? undefined;

    const language = this.infoValue(document, "Language");
    const type =
      language == null
        ? null
        : ((
            {
              korean: "Manhwa",
              chinese: "Manhua",
              japanese: "Manga",
            } as Record<string, string>
          )[language.toLowerCase()] ?? language);
    const tagGenres = document.select(".page__list > div:has(> dt:containsOwn(Genres)) > dd > a").map((it) => {
      const t = it.text();
      return t.charAt(0).toUpperCase() + t.slice(1);
    });
    manga.genre = [...(type != null ? [type] : []), ...tagGenres].join(", ");

    switch (this.infoValue(document, "Status")?.toLowerCase()) {
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
      case "finished":
        manga.status = SManga.COMPLETED;
        break;
      case "hiatus":
        manga.status = SManga.ON_HIATUS;
        break;
      case "cancelled":
      case "canceled":
        manga.status = SManga.CANCELLED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    return manga;
  }

  private infoValue(document: Document, label: string): string | null {
    return document.selectFirst(`.page__list > div:has(> dt:containsOwn(${label})) > dd`)?.text() ?? null;
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return document.select("section.sect--hot > .sect__content > a.poster").map((element) => {
      const m = SManga.create();
      m.url = urlWithoutDomain(element.absUrl("href"));
      m.title = element.selectFirst(".poster__title")!.text();
      m.thumbnail_url = element.selectFirst("img")?.absUrl("data-src");
      return m;
    });
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const raw = this.extractData(document);
    if (raw == null) return [];
    const data = parseAs<PageListDto>(raw);
    return data.images.map((img, idx) => new Page(idx, "", img.startsWith("http") ? img.trim() : this.baseUrl + img.trim()));
  }

  private extractData(document: Document): string | null {
    const script = document.selectFirst("script:containsData(window.__DATA__)")?.data();
    if (script == null) return null;
    return substringBefore(substringAfter(script, "window.__DATA__ = "), ";window.").trim().replace(/;$/, "").trim();
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const script = (await this.client.get(`${this.baseUrl}/comix/`)).asJsoup().selectFirst("script:containsData(window.__XFILTER__)")!.data();
    return toJsonElement(parseAs<XFilters>(substringAfter(script, "window.__XFILTER__ = ").trim().replace(/;$/, "")).filter_items.g.values);
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new Filter.Header("Filters are ignored for text search"), new SortFilter()];
    if (data != null) filters.push(new GenreFilter((data as FilterValue[]).map((it) => [it.value, it.id] as [string, number])));
    return FilterList(...filters);
  }

  private hdPosterUrl(mangaUrl: string): string | null {
    const slug = MANGA_PATH_REGEX.exec(mangaUrl)?.[1];
    if (slug == null) return null;
    const prefix = md5(slug)[0].toString(16).padStart(2, "0");
    return `${this.baseUrl}/uploads/posts/poster/${prefix}/${slug}.jpg`;
  }
}
