// Port of keiyoushi/extensions-source src/en/digitalcomicmuseum/DigitalComicMuseum.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, urlWithoutDomain } from "../../../sdk/index.ts";

/** MultipartBody.Builder().setType(FORM) with text parts only; returns the body and its Content-Type. */
function multipartForm(parts: [string, string][]): { body: string; contentType: string } {
  const boundary = `----DigitalComicMuseum${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const body = `${parts.map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join("")}--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export default class DigitalComicMuseum extends KeiSource {
  // Latest

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.listPage(`${this.baseUrl}/stats.php?ACT=latest&start=${page - 1}00&limit=100`);
  }

  // Popular

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.listPage(`${this.baseUrl}/stats.php?ACT=topdl&start=${page - 1}00&limit=100`);
  }

  private async listPage(url: string): Promise<MangasPage> {
    const document = (await this.client.get(url)).asJsoup();
    const mangas = document.select("tbody > .mainrow").map((element) => {
      const manga = SManga.create();
      manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
      const link = element.selectFirst("a")!;
      manga.url = urlWithoutDomain(link.attr("abs:href"));
      manga.title = link.text();
      return manga;
    });
    const hasNextPage = document.selectFirst("img[alt=Next]") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Search

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const { body, contentType } = multipartForm([["terms", query]]);
    const url = toHttpUrl(`${this.baseUrl}/index.php`).newBuilder().addQueryParameter("ACT", "dosearch").build();
    const headers = new Headers(this.headers);
    headers.set("Content-Type", contentType);
    const document = (await this.client.post(url.toString(), headers, body)).asJsoup();
    const mangas = document.select("#search-results tbody > tr").map((element) => {
      const manga = SManga.create();
      const baseElement = element.selectFirst("td > a")!;
      manga.url = urlWithoutDomain(baseElement.attr("abs:href"));
      manga.title = baseElement.text();
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  // Details & Chapters

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const elements = document.select(".tableborder");
    const firstElement = elements.first();
    if (firstElement) {
      manga.title = firstElement.select("#catname").text();
      manga.thumbnail_url = firstElement.selectFirst("table img")?.attr("abs:src");

      for (const it of elements) {
        if (it.selectFirst("#catname")?.text() === "Description") manga.description = it.selectFirst("table")?.text();
      }
    }

    const chapterList = elements.slice(0, 1).map((element) => {
      const chapter = SChapter.create();
      chapter.name = element.select("#catname").text();
      chapter.url = urlWithoutDomain(element.selectFirst(".tablefooter a:first-of-type")!.attr("abs:href"));
      return chapter;
    });

    return new SMangaUpdate(manga, chapterList);
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select(".reader-page-list a.reader-page-link").map((element, index) => new Page(index, element.attr("abs:href")));
  }

  override async getImageUrl(page: Page): Promise<string> {
    const document = (await this.client.get(page.url)).asJsoup();
    return document.selectFirst("img.reader-page-image")!.absUrl("src");
  }
}
