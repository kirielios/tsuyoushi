// Port of keiyoushi/extensions-source src/all/everiaclub/EveriaClub.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  distinctBy,
  firstInstanceOrNull,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type Element,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { postThumbnail, type WPCategoryDto, type WPPostDto, type WPTagDto } from "./dto.ts";
import { CategoryFilter, TagFilter, TagGroup } from "./filters.ts";

const DATE_REGEX = /[0-9]{4}\/[0-9]{2}\/[0-9]{2}/;
const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy/MM/dd", Locale.US);

/** What the background launchFilters() coroutine fetches upstream; here the host fetches it (fetchFilterData) and hands it back to getFilterList. */
interface FilterData {
  categories: [string, string][];
  tags: { name: string; id: number }[];
}

const imgSrc = (element: Element): string => {
  const lazy = element.attr("data-lazy-src");
  if (lazy.length > 0) return lazy;
  const dataSrc = element.attr("data-src");
  return dataSrc.length > 0 ? dataSrc : element.attr("src");
};

export default class EveriaClub extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  override headersBuilder(): Headers {
    const headers = super.headersBuilder();
    headers.append("Referer", `${this.baseUrl}/`);
    return headers;
  }

  // ========================= Popular =========================
  protected popularMangaRequest(_page: number): Request {
    return GET(this.baseUrl, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(".wli_popular_posts-class li").map((element) => {
      const manga = SManga.create();
      manga.thumbnail_url = element.selectFirst("img") ? imgSrc(element.selectFirst("img")!) : undefined;
      manga.title = element.select("h3").text();
      manga.url = urlWithoutDomain(element.select("h3 > a").attr("abs:href"));
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  // ========================= Latest =========================
  protected latestUpdatesRequest(page: number): Request {
    const url = toHttpUrl(`${this.baseUrl}/wp-json/wp/v2/posts`)
      .newBuilder()
      .addQueryParameter("page", String(page))
      .addQueryParameter("per_page", "20")
      .addQueryParameter("_embed", "wp:featuredmedia")
      .build();
    return GET(url, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    const posts = response.parseAs<WPPostDto[]>();
    const mangas = posts.map((post) => {
      const manga = SManga.create();
      manga.title = post.title.rendered;
      manga.url = urlWithoutDomain(post.link);
      manga.thumbnail_url = postThumbnail(post);
      return manga;
    });
    const totalPages = this.toIntOrNull(response.header("X-WP-TotalPages")) ?? 0;
    const currentPage = this.toIntOrNull(new URL(response.url).searchParams.get("page")) ?? 0;
    return new MangasPage(mangas, currentPage < totalPages);
  }

  private toIntOrNull(s: string | null): number | null {
    return s != null && /^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null;
  }

  // ========================= Search =========================
  // upstream handles URLs in fetchSearchManga, so bypass KeiSource's URL handling
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("http")) {
      const url = toHttpUrlOrNull(query);
      if (url != null && url.host === toHttpUrlOrNull(this.baseUrl)?.host) {
        const pathSegments = url.pathSegments.filter((it) => it.length > 0);
        if (pathSegments.length === 0) return super.fetchSearchManga(page, query, filters);

        if (pathSegments[0] === "category" || pathSegments[0] === "tag") {
          const builder = url.newBuilder();
          const pageIdx = url.pathSegments.indexOf("page");
          if (pageIdx !== -1) {
            builder.setPathSegment(pageIdx + 1, String(page));
          } else {
            builder.addPathSegment("page");
            builder.addPathSegment(String(page));
          }
          const response = await this.executeSuccess(GET(builder.build(), this.headers));
          return this.parseHtmlMangasPage(response);
        }
        // Post link
        const response = await this.executeSuccess(GET(query, this.headers));
        const document = response.asJsoup();
        const manga = SManga.create();
        manga.url = url.encodedPath;
        const title = document.selectFirst(".entry-title")?.text();
        if (title == null) throw new Error("Title is mandatory");
        manga.title = title;
        const img = document.selectFirst(".entry-content img");
        manga.thumbnail_url = img ? imgSrc(img) : undefined;
        return new MangasPage([manga], false);
      }
    }
    return super.fetchSearchManga(page, query, filters);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const filterList = filters.length === 0 ? this.getFilterList() : filters;
    const categoryFilter = firstInstanceOrNull(filterList, CategoryFilter);
    const tagGroup = firstInstanceOrNull(filterList, TagGroup);

    const url = toHttpUrl(`${this.baseUrl}/wp-json/wp/v2/posts`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("per_page", "20").addQueryParameter("_embed", "wp:featuredmedia");

    if (query.length > 0) {
      url.addQueryParameter("search", query);
    }

    if (categoryFilter != null && categoryFilter.state !== 0) {
      url.addQueryParameter("categories", categoryFilter.toUriPart());
    }

    if (tagGroup != null) {
      const includedTags = tagGroup.state.filter((it) => it.state === Filter.TriState.STATE_INCLUDE).map((it) => it.id);
      const excludedTags = tagGroup.state.filter((it) => it.state === Filter.TriState.STATE_EXCLUDE).map((it) => it.id);

      if (includedTags.length > 0) {
        url.addQueryParameter("tags", includedTags.join(","));
      }
      if (excludedTags.length > 0) {
        url.addQueryParameter("tags_exclude", excludedTags.join(","));
      }
    }

    return GET(url.build(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.latestUpdatesParse(response);
  }

  // ========================= Details =========================
  protected mangaDetailsParse(response: Response): SManga {
    const manga = SManga.create();
    const document = response.asJsoup();
    manga.title = document.select(".entry-title").text();
    manga.description = document.select(".entry-title").text();
    manga.genre = document
      .select(".post-tags > a")
      .map((it) => it.text())
      .join(", ");
    manga.status = SManga.COMPLETED;
    manga.initialized = true;
    return manga;
  }

  // TODO: After converting the whole extension to use API, we can request list of tags' ID directly then use them to build queries.
  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    if (manga.genre == null) return [];
    const genres = manga.genre.split(",").map((it) => it.trim());
    const results = await Promise.all(
      genres.map(async (genre) => {
        try {
          const tag = this.tags.find((it) => it.name.toLowerCase() === genre.toLowerCase());
          let request: Request;
          if (tag != null) {
            const tagFilter = new TagFilter(tag.name, tag.id);
            tagFilter.state = Filter.TriState.STATE_INCLUDE;
            request = this.searchMangaRequest(1, "", FilterList(new TagGroup([tagFilter])));
          } else {
            request = this.searchMangaRequest(1, genre, FilterList(new Filter.Header("Avoid running `launchFilters()`")));
          }
          return this.searchMangaParse(await this.executeSuccess(request)).mangas;
        } catch (e) {
          console.error(e);
          return [] as SManga[];
        }
      }),
    );
    return results.flat();
  }

  // ========================= Chapters =========================
  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    const chapter = SChapter.create();
    const canonicalUrl = document.selectFirst('link[rel="canonical"]')?.attr("href") ?? response.url;
    chapter.url = urlWithoutDomain(canonicalUrl);
    chapter.chapter_number = -2;
    chapter.name = "Gallery";
    chapter.date_upload = this.getDate(canonicalUrl);
    return [chapter];
  }

  // ========================= Pages =========================
  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.executeSuccess(await this.pageListRequest(chapter));
    const document = response.asJsoup();
    const pageLinks = distinctBy(
      document.select(".page-links a.post-page-numbers").map((it) => it.attr("abs:href")),
      (it) => it,
    );

    let urls: string[];
    if (pageLinks.length === 0) {
      urls = this.parseImages(document);
    } else {
      // ponytail: upstream's flatMap(…, 3) emits pages in completion order; this keeps page order, 3 at a time
      const docs: (Element | null)[] = [];
      for (let i = 0; i < pageLinks.length; i += 3) {
        docs.push(
          ...(await Promise.all(
            pageLinks.slice(i, i + 3).map(async (url) => {
              try {
                return (await this.executeSuccess(GET(url, this.headers))).asJsoup();
              } catch {
                return null;
              }
            }),
          )),
        );
      }
      const allDocs = [document, ...docs.filter((it): it is Element => it != null)];
      urls = allDocs.flatMap((it) => this.parseImages(it));
    }

    return distinctBy(urls, (it) => it)
      .filter((it) => it.length > 0 && !it.startsWith("data:image"))
      .map((url, i) => new Page(i, "", url));
  }

  private parseImages(document: Element): string[] {
    document.select("noscript").remove();
    return document.select(".entry-content img").map((it) => imgSrc(it));
  }

  protected pageListParse(_response: Response): Page[] {
    throw new Error("UnsupportedOperationException");
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Filters =========================
  private categories: [string, string][] = [
    ["Any", ""],
    ["China", "42"],
    ["Cosplay", "7"],
    ["Japan", "2"],
    ["Korea", "11"],
    ["Thailand", "1984"],
  ];
  private tags: TagFilter[] = [];

  override get supportsFilterFetching() {
    return true;
  }

  /** launchFilters(): categories and tags from the WordPress API. */
  override async fetchFilterData(): Promise<FilterData> {
    const catDtos = (await this.executeSuccess(GET(`${this.baseUrl}/wp-json/wp/v2/categories?per_page=100&hide_empty=true`, this.headers))).parseAs<WPCategoryDto[]>();
    const categories: [string, string][] = [["Any", ""], ...catDtos.map((it): [string, string] => [it.name, String(it.id)])];
    const tagDtos = (await this.executeSuccess(GET(`${this.baseUrl}/wp-json/wp/v2/tags?per_page=100&hide_empty=true&orderby=count&order=desc`, this.headers))).parseAs<WPTagDto[]>();
    return { categories, tags: tagDtos.map((it) => ({ name: it.name, id: it.id })) };
  }

  override getFilterList(data: unknown = null): FilterList {
    const fetched = data as FilterData | null;
    if (fetched) {
      this.categories = fetched.categories;
      this.tags = fetched.tags.map((it) => new TagFilter(it.name, it.id));
    }
    const filters: Filter[] = [new Filter.Header("NOTE: Category filter can be combined with search."), new Filter.Separator(), new CategoryFilter(this.categories)];

    if (this.tags.length > 0) {
      filters.push(new TagGroup(this.tags));
    }

    return filters;
  }

  // ========================= Helpers =========================
  private parseHtmlMangasPage(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("#blog-entries > article, #content > article").map((element) => {
      const manga = SManga.create();
      const img = element.selectFirst("img");
      manga.thumbnail_url = img ? imgSrc(img) : undefined;
      manga.title = element.select(".entry-title").text();
      manga.url = urlWithoutDomain(element.select(".entry-title > a").attr("abs:href"));
      return manga;
    });
    const hasNextPage = document.selectFirst(".next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private getDate(str: string): number {
    const match = DATE_REGEX.exec(str);
    return match ? DATE_FORMAT.tryParseDate(match[0]) : 0;
  }
}
