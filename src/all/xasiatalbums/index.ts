// Port of keiyoushi/extensions-source src/all/xasiatalbums/XAsiatAlbums.kt
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, distinctBy, firstInstanceOrNull, substringAfter, toHttpUrl, urlWithoutDomain, type Element } from "../../../sdk/index.ts";
import { UriPartFilter, initialCategories } from "./filters.ts";

const ITEMS_PER_PAGE = 12;

export default class XAsiatAlbums extends KeiSource {
  // Mutable map seeded from initialCategories; new tags discovered while
  // browsing album detail pages are added here at runtime.
  private readonly categories = new Map(initialCategories);

  // --- Headers ----------------------------------------------------------

  // Used for HTML / API requests only. Images are fetched without it
  // so we don't send XMLHttpRequest to the CDN (which can cause 403s).
  protected override configureHeaders(headers: Headers): Headers {
    headers.append("X-Requested-With", "XMLHttpRequest");
    return headers;
  }

  // --- Popular / Latest -------------------------------------------------

  getPopularManga(page: number): Promise<MangasPage> {
    return this.searchQuery("albums/", "list_albums_common_albums_list", page, { sort_by: "album_viewed_week" });
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.searchQuery("albums/", "list_albums_common_albums_list", page, { sort_by: "post_date" });
  }

  // --- Search -----------------------------------------------------------

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const categoryFilter = firstInstanceOrNull(filters, UriPartFilter);

    if (query.trim() !== "") return this.searchQuery("search/search/", "list_albums_albums_list_search_result", page, { q: query });
    if (categoryFilter != null && categoryFilter.state > 0) return this.searchQuery(categoryFilter.toUriPart(), "list_albums_common_albums_list", page, {});
    return this.getLatestUpdates(page);
  }

  // Shared async-block request used by popular / latest / search.
  private async searchQuery(path: string, blockId: string, page: number, params: Record<string, string>): Promise<MangasPage> {
    const offset = (page - 1) * ITEMS_PER_PAGE + 1;

    const builder = toHttpUrl(this.baseUrl).newBuilder();
    builder.addPathSegments(path.replace(/^\//, "").replace(/\/$/, ""));
    builder.addQueryParameter("mode", "async");
    builder.addQueryParameter("function", "get_block");
    builder.addQueryParameter("block_id", blockId);
    builder.addQueryParameter("from", String(offset));

    // Search endpoint requires a separate from_albums parameter.
    if (blockId.includes("search")) builder.addQueryParameter("from_albums", String(offset));

    for (const [key, value] of Object.entries(params)) builder.addQueryParameter(key, value);

    // Cache-busting timestamp expected by the site.
    builder.addQueryParameter("_", String(Date.now()));

    const document = (await this.client.get(builder.build().toString())).asJsoup();

    const found: SManga[] = [];
    for (const link of document.select(".list-albums .item a[href]")) {
      const mangaUrl = link.attr("abs:href");
      if (mangaUrl.trim() === "" || !mangaUrl.includes("/albums/")) continue;

      const manga = SManga.create();
      manga.url = urlWithoutDomain(mangaUrl);
      const titleAttr = link.attr("title");
      manga.title = titleAttr.trim() !== "" ? titleAttr : (link.selectFirst("img")?.attr("alt") ?? "");
      const img = link.selectFirst("img");
      if (img) {
        const original = img.attr("abs:data-original");
        manga.thumbnail_url = original.trim() !== "" ? original : img.attr("abs:src");
      }
      manga.status = SManga.COMPLETED;
      // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
      found.push(manga);
    }
    const mangas = distinctBy(found, (it) => it.url);

    // Primary: look for a Next link.  Fallback: full page of results
    // implies there is a next page (avoids missing pages when the site
    // uses icon-only pagination buttons).
    const hasNextPage = document.select(".pagination a[href], .pages a[href], .pager a[href]").some((it) => it.text().toLowerCase().includes("next")) || mangas.length >= ITEMS_PER_PAGE;

    return new MangasPage(mangas, hasNextPage);
  }

  // --- Manga details ----------------------------------------------------

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.resolveUrl(manga.url));
    const requestUrl = response.url;
    const document = response.asJsoup();

    const title = document.selectFirst(".entry-title")?.text();
    if (title != null) manga.title = title;
    manga.description = document.selectFirst("meta[property=og:description]")?.attr("content") ?? "";
    manga.thumbnail_url = document.selectFirst("meta[property=og:image]")?.attr("content");
    manga.genre = this.getTags(document).join(", ");
    manga.status = SManga.COMPLETED;
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK

    const chapter = SChapter.create();
    chapter.url = requestUrl.startsWith(this.baseUrl) ? requestUrl.slice(this.baseUrl.length) : requestUrl;
    chapter.name = "Photobook";
    chapter.date_upload = Date.now();

    return new SMangaUpdate(manga, [chapter]);
  }

  // Extracts tags from the detail page and registers any new ones so they
  // appear in the category filter during the current session.
  private getTags(document: Element): string[] {
    const tags: string[] = [];
    for (const a of document.select(".info-content a")) {
      const tag = a.text().trim();
      const href = a.attr("abs:href");

      if (tag !== "" && href.includes("/albums/")) {
        const link = substringAfter(href, ".com/").replace(/\/$/, "");
        if (link.trim() !== "") this.categories.set(tag, link);
        tags.push(tag);
      }
    }
    return tags;
  }

  // --- Page list --------------------------------------------------------

  // Album detail pages deliver ALL images on a single page (confirmed from live site:
  // even 98-image albums show every image at once with no internal pagination).
  async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.parseImagePages((await this.client.get(this.resolveUrl(chapter.url))).asJsoup()).map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  // Extracts image URLs from a gallery document.
  //
  // Confirmed live site structure (May 2026):
  //   <a href="/get_image/2/{32-char-hash}/sources/{dir}/{albumId}/{imageId}.jpg/">
  //     <img src="data:image/gif;base64,..." />   <- JS lazy-load placeholder
  //   </a>
  //
  // Key points:
  //  - The href ends with ".jpg/" (trailing slash) so endsWith(".jpg") would FAIL.
  //    Only url.contains("/get_image/") reliably matches these URLs.
  //  - The <img> never has a data-original attribute; the real URL is on the <a>.
  //  - DO NOT use a[href*='/albums/'] - that would also match the "Related Albums"
  //    section at the bottom of the page.
  private parseImagePages(document: Element): string[] {
    const urls = document
      .select("a.item[href], a[href*='/get_image/']")
      .map((it) => it.attr("abs:href"))
      .filter((u) => u.trim() !== "")
      .filter((it) => it.includes("/get_image/"));
    return [...new Set(urls)];
  }

  // Resolves a (possibly relative or protocol-relative) URL to an absolute one.
  private resolveUrl(url: string): string {
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    return this.baseUrl + url;
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const request = super.imageRequest(page);
    request.headers.delete("X-Requested-With");
    return request;
  }

  // --- Filters ----------------------------------------------------------

  override getFilterList(_data: unknown = null): FilterList {
    // "None" is pinned at index 0 (maps to empty string); all other
    // entries are sorted alphabetically.  This guarantees that
    // `categoryFilter.state > 0` correctly identifies a real category.
    const sorted = distinctBy(
      [...this.categories].filter(([k]) => k !== "None"),
      (it) => it[0],
    ).sort((a, b) => {
      const x = a[0].toLowerCase();
      const y = b[0].toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });

    const pairList: [string, string][] = [["None", ""], ...sorted];

    return FilterList(new Filter.Header("Tags update dynamically after opening albums"), new Filter.Separator(), new UriPartFilter("Category", pairList));
  }
}
