// Port of keiyoushi/extensions-source lib-multisrc/colorlibanime/ColorlibAnime.kt
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  substringAfter,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
} from "../../sdk/index.ts";
import { OrderFilter } from "./filters.ts";

const timeRegex = /Date\((\d+)\)/;

export abstract class ColorlibAnime extends KeiSource {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(3);
  }

  private toThumbnail(element: Element): string {
    return substringBeforeLast(element.select(".set-bg").attr("abs:data-setbg"), "?");
  }

  // Popular
  override getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", FilterList(new OrderFilter(0)));
  }

  // Latest
  override getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", FilterList(new OrderFilter(1)));
  }

  // Search
  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl)
      .newBuilder()
      .addPathSegment("manga")
      .addQueryParameter("page", String(page))
      .addQueryParameter("sort", filters.find((it): it is OrderFilter => it instanceof OrderFilter)?.toUriPart() ?? "view")
      .addQueryParameter("search", query)
      .build();

    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = document.select(".product__page__content > [style]:has(.col-6) .product__item").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.select("a.img-link").attr("abs:href"));
      manga.title = element.select("h5").text();
      manga.thumbnail_url = this.toThumbnail(element);
      return manga;
    });

    const hasNextPage = document.selectFirst(".fa-angle-right") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host || url.pathname.split("/")[1] !== "manga") return null;

    const manga = this.parseDetails((await this.client.get(url)).asJsoup());
    if (manga) manga.url = url.pathname;
    return manga;
  }

  // Details and chapters come from the same page
  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.parseDetails(document) ?? manga, this.parseChapters(document));
  }

  private parseDetails(document: Document): SManga | null {
    const element = document.selectFirst(".anime__details__content");
    if (!element) return null;

    const manga = SManga.create();
    manga.title = element.select("h3").text();
    manga.author = element.select("h3 + span").text();
    manga.description = element.select("p").text();
    manga.thumbnail_url = this.toThumbnail(element);
    switch (substringAfter(element.select("li:contains(status)").text(), " ")) {
      case "Ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "Complete":
        manga.status = SManga.COMPLETED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    return manga;
  }

  // Chapters
  private parseChapters(doc: Document): SChapter[] {
    const m = timeRegex.exec(doc.select("script:containsData(lastUpdated)").html());
    const time = m ? Number(m[1]) : 0;

    const chapters = doc.select(".anime__details__episodes a").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.attr("abs:href"));
      chapter.name = element.text();
      chapter.date_upload = 0;
      return chapter;
    });
    if (chapters.length) chapters[0].date_upload = time;
    return chapters;
  }

  // Pages
  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select(".container .read-img > img").map((element, i) => new Page(i, "", element.attr("abs:src")));
  }

  // Filters
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new OrderFilter());
  }
}
