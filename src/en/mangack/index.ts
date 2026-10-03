// Port of keiyoushi/extensions-source src/en/mangack/Mangack.kt (+ Dto.kt)
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  DateTimeFormatter,
  Locale,
  ZoneOffset,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
  type HttpUrl,
  type HttpUrlBuilder,
} from "../../../sdk/index.ts";
import { GenreFilterGroup, SortFilter, StatusFilter, TaxonomyOption, TypeFilter, YearFilter, isUriFilter } from "./filters.ts";

// --- Dto.kt
interface RenderedDto {
  rendered?: string;
}
interface MangaDto {
  link: string;
  title: RenderedDto;
  _embedded?: { "wp:featuredmedia"?: { source_url?: string | null }[] | null } | null;
}
interface TermPayloadDto {
  id: number;
  name: string;
}
interface FilterDataDto {
  genres: TermPayloadDto[];
  years: TermPayloadDto[];
}
interface ChapterContentDto {
  content?: RenderedDto | null;
}

const htmlEntityRegex = /&(#?[a-zA-Z0-9]+);/g;

function decodeEntities(s: string): string {
  return s.replace(htmlEntityRegex, (value, e: string) => {
    switch (e) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
      case "#39":
        return "'";
      case "nbsp":
        return " ";
      case "hellip":
        return "…";
      case "mdash":
        return "—";
      case "ndash":
        return "–";
      case "rsquo":
      case "#8217":
        return "'";
      case "lsquo":
      case "#8216":
        return "'";
      case "rdquo":
      case "#8221":
        return '"';
      case "ldquo":
      case "#8220":
        return '"';
      default: {
        if (!e.startsWith("#")) return value;
        const n = e.slice(1);
        return /^[+-]?\d+$/.test(n) ? String.fromCharCode(Number.parseInt(n, 10)) : value; // toIntOrNull()?.toChar()
      }
    }
  });
}

const PAGE_SIZE = 24;
const IMG_SRC_REGEX = /<img[^>]+src=["']([^"']+)["']/g;
const SKIP_ASSET_REGEX = /\/wp-content\/(?:themes|plugins)\/|\/(?:logo|icon|cropped|preroll|placeholder|loading|spinner|chainsaw)[^/]*\.(?:png|jpe?g|webp|gif|svg)/i;
const RELATIVE_NUMBER_REGEX = /^(\d+)/;

const absoluteDateFormat = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);

const titlecaseFirst = (s: string) => (s && s[0] !== s[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s);
const classNames = (e: Element) => e.attr("class").split(/\s+/).filter(Boolean);

export default class Mangack extends KeiSource {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2);
  }

  // ============================== Popular ===============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = this.mangaListUrlBuilder(page).addQueryParameter("orderby", "date").addQueryParameter("order", "desc").build();
    return this.mangaList(url, page);
  }

  // =============================== Latest ===============================

  // The REST `orderby=modified` reflects any edit to the manga post, not just
  // chapter publication, so we scrape /updates/ for true latest-by-chapter.
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const path = page <= 1 ? "/updates/" : `/updates/page/${page}/`;
    const document = (await this.client.get(this.baseUrl + path)).asJsoup();
    const mangas: SManga[] = [];
    for (const card of document.select(".latestmanga .Latest_chapter_update")) {
      const link = card.selectFirst("a[href*=/manga/]");
      if (!link) continue;
      const manga = SManga.create();
      manga.url = urlWithoutDomain(link.attr("abs:href"));
      manga.title = link.attr("title").trim() === "" ? link.text() : link.attr("title");
      const img = card.selectFirst("img");
      manga.thumbnail_url = img ? this.imgAttr(img) : undefined;
      mangas.push(manga);
    }
    const hasNextPage = document.selectFirst(".pagination a.next, a.next.page-numbers") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // =============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = this.mangaListUrlBuilder(page);
    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 0) builder.addQueryParameter("search", trimmedQuery);
    filters.filter(isUriFilter).forEach((it) => it.applyTo(builder));
    return this.mangaList(builder.build(), page);
  }

  private mangaListUrlBuilder(page: number): HttpUrlBuilder {
    return toHttpUrl(`${this.baseUrl}/wp-json/wp/v2/manga`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("per_page", String(PAGE_SIZE)).addQueryParameter("_embed", "wp:featuredmedia");
  }

  private async mangaList(url: HttpUrl, page: number): Promise<MangasPage> {
    const response = await this.client.get(url.toString());
    const totalPagesHeader = Number.parseInt(response.header("X-WP-TotalPages") ?? "", 10);
    const totalPages = Number.isNaN(totalPagesHeader) ? 1 : totalPagesHeader;
    const list = response.parseAs<MangaDto[]>().map((dto) => {
      const manga = SManga.create();
      manga.title = decodeEntities(dto.title.rendered ?? "");
      manga.thumbnail_url = dto._embedded?.["wp:featuredmedia"]?.[0]?.source_url ?? undefined;
      manga.url = urlWithoutDomain(dto.link);
      return manga;
    });
    return new MangasPage(list, page < totalPages);
  }

  // ============================== Details ================================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(doc, manga), this.chapterListParse(doc));
  }

  // The Ifenzi theme renders broken Author / Type rows (`foreach() over bool`),
  // but the taxonomy slugs survive on the <article> class list. Scraping the
  // public manga page also gives us Followers / Views, which the REST DTO omits.
  private mangaDetailsParse(doc: Document, manga: SManga): SManga {
    const article = doc.selectFirst("article");
    const articleClasses = article ? classNames(article) : [];

    const title = doc.selectFirst("h1.entry-title")?.text() ?? this.removeSuffix(doc.selectFirst("meta[property=og:title]")?.attr("content"), " mangack");
    if (title == null) throw new Error("Title not found");
    manga.title = title;

    manga.thumbnail_url = doc.selectFirst("meta[property=og:image]")?.attr("content") ?? this.orUndefined(article?.selectFirst("figure img, .mediumthumbnail1 img"), (e) => this.imgAttr(e));

    const typeSlug = articleClasses.find((it) => it.startsWith("comic-type-"));
    const typeName = typeSlug != null ? this.humanizeSlug(typeSlug.slice("comic-type-".length)) : null;

    const genreNames = articleClasses.filter((it) => it.startsWith("Genres-")).map((it) => this.humanizeSlug(it.slice("Genres-".length)));

    const statusSlug = articleClasses.find((it) => it.startsWith("manga-status-"))?.slice("manga-status-".length);

    const genre = [...genreNames, ...(typeName != null ? [typeName] : [])].filter((it) => it.length > 0).join(", ");
    manga.genre = genre.length > 0 ? genre : undefined;

    manga.status = this.parseStatus(statusSlug);

    manga.description = this.buildDescription(doc, article);
    return manga;
  }

  private removeSuffix(s: string | undefined, suffix: string): string | undefined {
    return s != null && s.endsWith(suffix) ? s.slice(0, -suffix.length) : s;
  }
  private orUndefined<T>(e: T | null | undefined, f: (e: T) => string): string | undefined {
    return e != null ? f(e) : undefined;
  }

  private buildDescription(doc: Document, article: Element | null): string | undefined {
    const synopsis = doc.selectFirst("meta[property=og:description]")?.attr("content").trim();

    const infobox = new Map<string, string>();
    for (const tr of (article ?? doc).select("table.infobox tr")) {
      const label = tr.selectFirst("td:first-child, th:first-child")?.text() ?? "";
      const rawValue = tr.selectFirst("td:nth-child(2), th:nth-child(2)")?.text() ?? "";
      const value = rawValue.includes("Warning") ? "" : rawValue;
      infobox.set(label, value);
    }

    const followers = doc.select(".follow-text").find((it) => it.text().toLowerCase().startsWith("followers"))?.text();
    const views = doc.select(".follow-text").find((it) => it.text().toLowerCase().startsWith("views"))?.text();

    const parts: string[] = [];
    if (synopsis) parts.push(synopsis);
    const alternative = infobox.get("Alternative");
    if (alternative) parts.push(`Alternative: ${alternative}`);
    const year = infobox.get("Realized in");
    if (year) parts.push(`Year: ${year}`);
    if (followers) parts.push(followers);
    if (views) parts.push(views);
    const description = parts.join("\n\n");
    return description.length > 0 ? description : undefined;
  }

  // =============================== Chapters ===============================

  private chapterListParse(document: Document): SChapter[] {
    return document.select("ul.chapterslist li").map((li) => {
      const chapter = SChapter.create();
      const link = li.selectFirst("a.title, a[href*=/chapter/]")!;
      chapter.url = urlWithoutDomain(link.attr("abs:href"));
      chapter.name = link.ownText() || link.text();
      chapter.date_upload = this.parseChapterDate(li.selectFirst(".entry-date")?.text());
      return chapter;
    });
  }

  // =============================== Pages =================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const slug = substringAfterLast(chapter.url.replace(/^\/+|\/+$/g, ""), "/");
    const url = toHttpUrl(`${this.baseUrl}/wp-json/wp/v2/chapter`).newBuilder().addQueryParameter("slug", slug).addQueryParameter("_fields", "id,content").build();
    const dto = (await this.client.get(url.toString())).parseAs<ChapterContentDto[]>()[0];
    if (!dto) return [];
    const html = dto.content?.rendered ?? "";
    return [...html.matchAll(IMG_SRC_REGEX)]
      .map((m) => m[1])
      .filter((u) => !SKIP_ASSET_REGEX.test(u))
      .map((u, i) => new Page(i, "", u));
  }

  // =============================== Filters ===============================

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<FilterDataDto> {
    const genres = this.client.get(`${this.baseUrl}/wp-json/wp/v2/Genres?per_page=100&hide_empty=true`).then((r) => r.parseAs<TermPayloadDto[]>());
    const years = this.client.get(`${this.baseUrl}/wp-json/wp/v2/realised?per_page=100&hide_empty=true&orderby=name&order=desc`).then((r) => r.parseAs<TermPayloadDto[]>());
    const [g, y] = await Promise.all([genres, years]);
    return { genres: g, years: y };
  }

  override getFilterList(data: unknown = null): FilterList {
    const taxonomies = data as FilterDataDto | null;
    const genres = (taxonomies?.genres ?? []).map((it) => new TaxonomyOption(it.id, it.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const years = (taxonomies?.years ?? []).map((it) => new TaxonomyOption(it.id, it.name));
    const list: Filter[] = [new TypeFilter(), new StatusFilter()];
    if (years.length > 0) list.push(new YearFilter(years));
    list.push(new SortFilter());
    if (genres.length > 0) {
      list.push(new Filter.Separator());
      list.push(new GenreFilterGroup(genres));
    }
    return FilterList(...list);
  }

  // =============================== Helpers ===============================

  private parseStatus(slug: string | undefined): number {
    switch (slug?.toLowerCase()) {
      case "ongoing":
      case "publishing":
      case "updating":
        return SManga.ONGOING;
      case "completed":
      case "complete":
      case "finished":
        return SManga.COMPLETED;
      case "hiatus":
      case "on-hiatus":
      case "on-hold":
        return SManga.ON_HIATUS;
      case "cancelled":
      case "canceled":
      case "dropped":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  private humanizeSlug(s: string): string {
    return s
      .split("-")
      .filter((it) => it.length > 0)
      .map(titlecaseFirst)
      .join(" ");
  }

  private parseChapterDate(raw: string | null | undefined): number {
    if (!raw) return 0;
    const text = raw.toLowerCase();
    const m = RELATIVE_NUMBER_REGEX.exec(text);
    const number = m ? Number.parseInt(m[1], 10) : null;
    if (number != null) {
      let msPerUnit: number;
      if (text.includes("second")) msPerUnit = 1_000;
      else if (text.includes("minute")) msPerUnit = 60_000;
      else if (text.includes("hour")) msPerUnit = 3_600_000;
      else if (text.includes("day")) msPerUnit = 86_400_000;
      else if (text.includes("week")) msPerUnit = 604_800_000;
      else if (text.includes("month")) msPerUnit = 2_592_000_000;
      else if (text.includes("year")) msPerUnit = 31_536_000_000;
      else return 0;
      return Date.now() - number * msPerUnit;
    }
    return absoluteDateFormat.tryParseDate(raw, ZoneOffset.UTC);
  }

  private imgAttr(e: Element): string {
    if (e.hasAttr("data-src")) return e.attr("abs:data-src");
    if (e.hasAttr("data-lazy-src")) return e.attr("abs:data-lazy-src");
    if (e.hasAttr("srcset")) return substringBefore(e.attr("abs:srcset"), " ");
    return e.attr("abs:src");
  }
}
