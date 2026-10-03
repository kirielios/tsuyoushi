// Port of keiyoushi/extensions-source src/en/mangatown/Mangatown.kt
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, urlWithoutDomain, type Document, type Element, type FilterList } from "../../../sdk/index.ts";

const orNull = (s: string) => (s.length === 0 ? undefined : s);

export default class Mangatown extends KeiSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM dd,yyyy", Locale.US);

  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/directory/0-0-0-0-0-0/${page}.htm`)).asJsoup();
    return this.parseMangasPage(document);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/latest/${page}.htm`)).asJsoup();
    return this.parseMangasPage(document);
  }

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("name", query).build();
    const document = (await this.client.get(url.toString())).asJsoup();
    return this.parseMangasPage(document);
  }

  private parseMangasPage(document: Document): MangasPage {
    const mangas = document.select("li:has(a.manga_cover)").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst("div.next-page a.next:not([href^=javascript]), .page-nav a:contains(next):not([href^=javascript])") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const it = element.selectFirst("p.title a")!;
    manga.url = urlWithoutDomain(it.absUrl("href"));
    manga.title = it.text();
    manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document), this.parseChapterList(document));
  }

  private parseMangaDetails(document: Document): SManga {
    const infoElement = document.selectFirst("div.article_content")!;

    const manga = SManga.create();
    manga.title = infoElement.selectFirst("h1")!.text();
    manga.author = orNull(
      infoElement
        .select("li:has(b:containsOwn(author)) a")
        .map((it) => it.text())
        .join(", "),
    );
    manga.artist = orNull(
      infoElement
        .select("li:has(b:containsOwn(artist)) a")
        .map((it) => it.text())
        .join(", "),
    );
    manga.status = infoElement.selectFirst("div.chapter_content:contains(has been licensed)") != null ? SManga.LICENSED : this.parseStatus(infoElement.selectFirst("li:has(b:containsOwn(status))")?.textOrNull());
    manga.genre = orNull(
      infoElement
        .select("li:has(b:containsOwn(genre)) a")
        .map((it) => it.text())
        .join(", "),
    );
    const desc = document.selectFirst("span#show")?.textOrNull() ?? undefined;
    manga.description = desc?.endsWith("HIDE") ? desc.slice(0, -"HIDE".length) : desc;
    manga.thumbnail_url = document.selectFirst("div.detail_info img")?.absUrl("src");
    return manga;
  }

  private parseStatus(status: string | null | undefined): number {
    if (status == null) return SManga.UNKNOWN;
    const s = status.toLowerCase();
    if (s.includes("ongoing")) return SManga.ONGOING;
    if (s.includes("completed")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  private parseChapterList(document: Document): SChapter[] {
    return document.select("ul.chapter_list li").map((it) => this.chapterFromElement(it));
  }

  private chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const urlElement = element.selectFirst("a")!;
    chapter.url = urlWithoutDomain(urlElement.absUrl("href"));
    chapter.name = `${urlElement.text()} ${element
      .select("span:not(span.time,span.new)")
      .map((it) => it.text())
      .join(" ")}`;
    chapter.date_upload = this.parseDate(element.select("span.time").text());
    return chapter;
  }

  private parseDate(date: string): number {
    if (date.includes("Today")) return Date.now();
    if (date.includes("Yesterday")) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.getTime();
    }
    return this.dateFormat.tryParseDate(date);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const elements = document.select("select#top_chapter_list ~ div.page_select option:not(:contains(featured))");
    if (elements.length > 0) {
      return elements.map((e, i) => new Page(i, e.absUrl("value")));
    }
    return document.select("div#viewer img").map((e, i) => new Page(i, "", e.absUrl("src")));
  }

  override async getImageUrl(page: Page): Promise<string> {
    const document = (await this.client.get(page.url)).asJsoup();
    return document.selectFirst("div#viewer img")!.absUrl("src");
  }
}
