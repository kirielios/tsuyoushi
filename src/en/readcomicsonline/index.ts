// Port of keiyoushi/extensions-source src/en/readcomicsonline/ReadComicsOnline.kt
import { DateTimeFormatter, FilterList, Locale, MangasPage, Page, SChapter, SManga, toHttpUrl, urlWithoutDomain, type Document, type Element } from "../../../sdk/index.ts";
import { MMRCMS, isUriFilter } from "../../../themes/mmrcms/index.ts";

export default class ReadComicsOnline extends MMRCMS {
  protected override itemPath = "comic";

  protected override chapterString = "";

  protected override fetchFilterOptions = false;

  protected override detailsTitleSelector = "h1.text-2xl";

  protected override dateFormat = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US);

  protected override popularMangaUrl(page: number) {
    return `${this.baseUrl}/comic-list?sort=views&page=${page}`;
  }

  protected override popularMangaSelector(): string {
    return "div.comic-list-layout .grid > .group";
  }

  protected override popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const anchor = element.selectFirst("a.block.text-sm.font-semibold")!;

    manga.url = urlWithoutDomain(anchor.absUrl("href"));
    manga.title = anchor.text();
    manga.thumbnail_url = this.guessCover(manga.url, element.selectFirst("img")?.attr("src"));
    return manga;
  }

  protected override popularMangaNextPageSelector(): string | null {
    return "nav a[rel=next]";
  }

  protected override latestUpdatesUrl(page: number) {
    return `${this.baseUrl}/comic-list?sort=latest&page=${page}`;
  }

  protected override latestUpdatesSelector() {
    return this.popularMangaSelector();
  }

  protected override searchMangaSelector(): string {
    return "div a:has(img)";
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const resDoc = (await this.client.get(this.searchMangaUrl(page, query, filters))).asJsoup();
    const mangas = resDoc.select(this.searchMangaSelector()).map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.absUrl("href"));
      manga.title = element.selectFirst("p")!.text();
      manga.thumbnail_url = element.selectFirst("img")!.absUrl("src");
      return manga;
    });
    const hasNextPage = resDoc.selectFirst("span a[rel=next]") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  protected override searchMangaUrl(page: number, query: string, filters: FilterList): string {
    const b = toHttpUrl(this.baseUrl).newBuilder();
    b.addPathSegment("advanced-search");
    b.addQueryParameter("name", query);
    b.addQueryParameter("page", String(page));
    filters.filter(isUriFilter).forEach((it) => it.addToUri(b));
    return b.build().toString();
  }

  protected override mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst("h1.text-2xl")?.text() ?? "";
    const img = document.selectFirst("img.w-full.rounded-xl");
    manga.thumbnail_url = this.guessCover(document.location(), img ? this.imgAttr(img) : null);
    manga.description = document.selectFirst("p.mt-5.text-sm")?.text() ?? "";

    const status = document.selectFirst("div.flex.flex-wrap.gap-2 span.rounded-full");
    if (status) manga.status = this.parseStatus(status.text());
    manga.genre = document
      .select("dl div:contains(Genres:) a")
      .map((it) => it.text())
      .join(", ");
    manga.author = document
      .select("div:has(span:contains(Author:)) > a")
      .map((it) => it.text())
      .join(", ");
    return manga;
  }

  protected override chapterListSelector(): string {
    return ".overflow-hidden.border-ink-600 > a";
  }

  protected override chapterFromElement(element: Element, mangaTitle: string): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.absUrl("href"));

    const chapterName = element.selectFirst(".text-brand-400")?.text() ?? element.text();
    chapter.name = this.cleanChapterName(mangaTitle, chapterName);

    chapter.date_upload = this.dateFormat.tryParseDate(element.selectFirst(".text-slate-500")?.text());
    return chapter;
  }

  protected override pageListParse(document: Document): Page[] {
    return document.select("#reader-all img").map((img, i) => new Page(i, "", this.imgAttr(img)));
  }
}
