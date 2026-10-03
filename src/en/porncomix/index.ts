// Port of keiyoushi/extensions-source src/en/porncomix/PornComix.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, isBlank, toHttpUrl, urlWithoutDomain, type Element, type FilterList } from "../../../sdk/index.ts";

export default class PornComix extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private lazyImg(img: Element): string {
    return img.absUrl("data-pagespeed-lazy-src") || img.absUrl("data-src") || img.absUrl("src");
  }

  // ======================== Popular ========================

  async getPopularManga(page: number): Promise<MangasPage> {
    return page === 1 ? this.parseMangaList(`${this.baseUrl}/multporn-net/`) : this.parseMangaList(`${this.baseUrl}/multporn-net/page/${page}/`);
  }

  private async parseMangaList(url: string): Promise<MangasPage> {
    const document = (await this.client.get(toHttpUrl(url).toString())).asJsoup();
    const mangas = document.select("#loops-wrapper article").map((element) => {
      const manga = SManga.create();
      const anchor = element.selectFirst("h2.post-title a")!;
      manga.url = urlWithoutDomain(anchor.attr("href"));
      manga.title = anchor.text();

      const img = element.selectFirst("img");
      manga.thumbnail_url = img ? this.lazyImg(img) : undefined;
      return manga;
    });
    const hasNextPage = document.selectFirst("a.nextp") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // ======================== Latest (disabled) ========================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ======================== Search ========================

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    if (isBlank(query)) return this.getPopularManga(page);

    const url = toHttpUrl(this.baseUrl).newBuilder();
    if (page > 1) {
      url.addPathSegment("page");
      url.addPathSegment(String(page));
    }
    url.addQueryParameter("s", query.trim());

    return this.parseMangaList(url.build().toString());
  }

  // ======================== Details ========================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? await this.fetchMangaDetails(manga) : manga;
    let chapterList = chapters;
    if (fetchChapters) {
      const chapter = SChapter.create();
      chapter.name = "CHAPTER";
      chapter.url = urlWithoutDomain(manga.url);
      chapterList = [chapter];
    }

    return new SMangaUpdate(details, chapterList);
  }

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    manga.title = document.selectFirst("h1.post-title, h1.entry-title")!.text();

    const img = document.selectFirst("div.post-inner img, div.entry-content img, article img");
    manga.thumbnail_url = img ? this.lazyImg(img) : undefined;

    manga.description = document.selectFirst("div.entry-content p, div.post-content p")?.text();

    // Tags / genres
    const tags = document
      .select("a[rel=tag], .post-tags a, .tags-links a")
      .map((it) => it.text())
      .filter((it) => it.length > 0);
    if (tags.length > 0) {
      manga.genre = tags.join(", ");
    }

    manga.status = SManga.COMPLETED;
    // ponytail: upstream sets update_strategy = ONLY_FETCH_ONCE; the SDK's SManga has no such field.

    return manga;
  }

  // ======================== Pages ========================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const pswp = document.select(".pswp-gallery__item");

    if (pswp.length > 0) {
      return pswp.map((element, index) => new Page(index, "", element.absUrl("data-pswp-src")));
    }

    return document.select("div.entry-content img").map((img, index) => new Page(index, "", this.lazyImg(img)));
  }
}
