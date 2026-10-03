// Port of keiyoushi/extensions-source src/en/xyzcomics/XyzComics.kt
import { Filter, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, urlWithoutDomain, type Element, type FilterList } from "../../../sdk/index.ts";

const ARTIST_TAG_FILTER_NAME = "Artist or Tag";

class ArtistTagFilter extends Filter.Text {
  constructor() {
    super(ARTIST_TAG_FILTER_NAME);
  }
}

export default class XyzComics extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  getPopularManga(page: number): Promise<MangasPage> {
    const url = page === 1 ? `${this.baseUrl}/allsexkomix/` : `${this.baseUrl}/allsexkomix/page/${page}/`;
    return this.parseMangaList(url);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const artistTag = firstInstanceOrNull(filters, ArtistTagFilter)?.state?.trim();
    let url: string;
    if (artistTag) {
      const slug = artistTag
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/^-+|-+$/g, "");
      url = page === 1 ? `${this.baseUrl}/tag/${slug}/` : `${this.baseUrl}/tag/${slug}/page/${page}/`;
    } else {
      url = page === 1 ? `${this.baseUrl}/?s=${query}` : `${this.baseUrl}/page/${page}/?s=${query}`;
    }
    return this.parseMangaList(url);
  }

  private async parseMangaList(url: string): Promise<MangasPage> {
    const doc = (await this.client.get(url)).asJsoup();
    const items = doc.select("article.post").map((it) => this.popManga(it)).filter((m): m is SManga => m !== null);
    const hasNextPage = doc.selectFirst("a.nextp, .pagenav a.next, a.page-numbers.next, a[rel=next]") != null;
    return new MangasPage(items, hasNextPage);
  }

  private popManga(el: Element): SManga | null {
    const thumbLink = el.selectFirst("figure.post-image a");
    if (!thumbLink) return null;
    const titleEl = el.selectFirst("h2.post-title a");
    if (!titleEl) return null;
    const manga = SManga.create();
    manga.url = urlWithoutDomain(thumbLink.absUrl("href"));
    manga.title = titleEl.text().trim();
    const img = el.selectFirst("figure.post-image img.wp-post-image");
    if (img) manga.thumbnail_url = img.absUrl("data-src") || img.absUrl("src");
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    if (fetchDetails) {
      const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
      manga.title = doc.selectFirst("h1.post-title a, h1.post-title")?.text() ?? doc.selectFirst("title")!.text();
      manga.thumbnail_url = doc.selectFirst(".pswp-gallery .pswp-gallery__item a[href]")?.absUrl("href");
      const tags = doc.select("a.post-tag-button");
      manga.genre = tags.map((it) => it.text().trim()).join(", ");
      manga.status = SManga.UNKNOWN;
    }

    const chapter = SChapter.create();
    chapter.name = "Chapter 1";
    chapter.chapter_number = 1;
    chapter.url = urlWithoutDomain(manga.url);
    return new SMangaUpdate(manga, [chapter]);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const doc = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return doc.select(".pswp-gallery .pswp-gallery__item a[href]").map((link, i) => new Page(i, "", link.absUrl("href")));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return [new Filter.Header(`See all artists & tags: ${this.baseUrl}/all-the-artists-and-tags/`), new Filter.Separator(), new ArtistTagFilter()];
  }
}
