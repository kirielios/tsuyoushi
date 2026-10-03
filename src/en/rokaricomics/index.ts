// Port of keiyoushi/extensions-source src/en/rokaricomics/RokariComics.kt
import { FilterList, MangasPage, SManga, toHttpUrl, urlWithoutDomain, type Element, type Response } from "../../../sdk/index.ts";
import { AuthorFilter, MangaThemesiaAlt, YearFilter } from "../../../themes/mangathemesia/index.ts";

export default class RokariComics extends MangaThemesiaAlt {
  // Popular - Use homepage "Popular Today" section (first page only, no pagination)
  override async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    // Select manga from "Popular Today" section (first listupd on homepage)
    const mangas = document.select(".bixbox:has(h2:contains(Popular)) .bs .bsx").map((element) => this.homeMangaFromElement(element));
    return new MangasPage(mangas, false);
  }

  // Latest - Use homepage pagination which shows latest updates
  override async getLatestUpdates(page: number) {
    return this.latestUpdatesParse(await this.client.get(page === 1 ? this.baseUrl : `${this.baseUrl}/page/${page}/`));
  }

  private latestUpdatesParse(response: Response): MangasPage {
    const document = response.asJsoup();
    // Select manga from "Latest Update" section (second listupd on homepage)
    const mangas = document.select(".bixbox:has(h2:contains(Latest)) .bs .bsx").map((element) => this.homeMangaFromElement(element));
    const hasNextPage = document.selectFirst("div.hpage .r, div.pagination .next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  /** The SManga.create().apply { ... } block repeated in both parsers upstream. */
  private homeMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const a = element.select("a").first();
    if (a) {
      manga.url = urlWithoutDomain(a.attr("href"));
      manga.title = a.attr("title");
    }
    const img = element.select("img").first();
    manga.thumbnail_url = img ? img.attr("abs:data-lazy-src") || img.attr("abs:data-src") || img.attr("abs:src") : undefined;
    return manga;
  }

  // Site changed from /manga/ directory to using search page /?s=
  override searchMangaUrl(page: number, query: string) {
    return toHttpUrl(this.baseUrl).newBuilder().addQueryParameter("s", query).addQueryParameter("page", String(page));
  }

  // Filter out chapters that have the coin cost indicator (paywalled chapters)
  // These chapters have a span with "text-gold" class containing the coin price
  protected override chapterListSelector() {
    return "#chapterlist li:has(div.chbox):has(div.eph-num):has(a[href]):not(:has(.text-gold))";
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters = super.getFilterList(data).filter((it) => !(it instanceof AuthorFilter || it instanceof YearFilter));
    return FilterList(...filters);
  }
}
