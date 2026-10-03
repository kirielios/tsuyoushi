// Port of keiyoushi/extensions-source src/en/yaoihot/YaoiHot.kt
import { HttpUrl, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, ago, substringAfter, substringBefore, urlWithoutDomain, type FilterList, type Response } from "../../../sdk/index.ts";

export default class YaoiHot extends KeiSource {
  // ============================== Popular ===============================
  async getPopularManga(page: number): Promise<MangasPage> {
    const url = HttpUrl.parse(this.baseUrl).newBuilder();
    url.addPathSegment("manga");
    if (page > 1) {
      url.addPathSegment("page");
      url.addPathSegment(String(page));
    }
    url.addQueryParameter("orderby", "views");

    return this.parseMangaList(await this.client.get(url.build().toString()));
  }

  // =============================== Latest ===============================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = HttpUrl.parse(this.baseUrl).newBuilder();
    url.addPathSegment("manga");
    if (page > 1) {
      url.addPathSegment("page");
      url.addPathSegment(String(page));
    }
    url.addQueryParameter("orderby", "modified");

    return this.parseMangaList(await this.client.get(url.build().toString()));
  }

  // =============================== Search ===============================
  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = HttpUrl.parse(this.baseUrl).newBuilder();
    if (query.trim() !== "") {
      if (page > 1) {
        url.addPathSegment("page");
        url.addPathSegment(String(page));
      }
      url.addQueryParameter("s", query);
      url.addQueryParameter("post_type", "manga");
    } else {
      // Fallback to popular if the query is empty
      url.addPathSegment("manga");
      if (page > 1) {
        url.addPathSegment("page");
        url.addPathSegment(String(page));
      }
      url.addQueryParameter("orderby", "views");
    }

    return this.parseMangaList(await this.client.get(url.build().toString()));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const u = HttpUrl.parse(url.href);
    if (u.host === HttpUrl.parse(this.baseUrl).host && u.pathSegments[0] === "manga") {
      const slug = u.pathSegments[1];
      const manga = SManga.create();
      manga.url = `/manga/${slug}/`;
      const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
      result.initialized = true;
      result.url = `/manga/${slug}`;
      return result;
    }
    return null;
  }

  private parseMangaList(response: Response): MangasPage {
    const document = response.asJsoup();

    const mangas = document.select(".manga-grid .manga-card").map((element) => {
      const manga = SManga.create();
      const link = element.selectFirst(".manga-card-link")!;
      manga.url = urlWithoutDomain(link.absUrl("href"));
      manga.title = element.selectFirst(".manga-card-title")!.text();
      manga.thumbnail_url = element.selectFirst(".manga-cover-img")?.absUrl("src");
      return manga;
    });

    const hasNextPage = document.selectFirst(".next.page-numbers") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  // =========================== Manga Updates ============================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();

    const details = SManga.create();
    details.title = document.selectFirst(".manga-title")!.text();
    const author = document.selectFirst(".author-line")?.text();
    details.author = author != null ? substringAfter(author, "Author:").trim() : undefined;
    details.description = document.selectFirst(".summary-content")?.text();
    details.genre = document
      .select(".genre-tag")
      .map((it) => it.text())
      .join(", ");
    details.thumbnail_url = document.selectFirst(".manga-cover-img")?.absUrl("src");

    const chapters = document.select(".chapters-list .chapter-item").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.absUrl("href"));
      chapter.name = element.selectFirst(".chapter-title")!.text();
      const date = element.selectFirst(".chapter-date")?.text();
      chapter.date_upload = date != null ? this.parseRelativeDate(date) : 0;
      return chapter;
    });

    return new SMangaUpdate(details, chapters);
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();

    return document.select(".reader-page img").map((img, index) => {
      const src = img.absUrl("src");
      return new Page(index, "", src === "" ? img.absUrl("data-src") : src);
    });
  }

  // ============================= Utilities ==============================
  private parseRelativeDate(dateStr: string): number {
    const trimmed = dateStr.trim().toLowerCase();
    if (trimmed === "") return 0;

    const first = substringBefore(trimmed, " ");
    if (!/^[+-]?\d+$/.test(first)) return 0;
    const number = Number.parseInt(first, 10);

    if (trimmed.includes("year")) return ago(number, "years");
    if (trimmed.includes("month")) return ago(number, "months");
    if (trimmed.includes("week")) return ago(number, "weeks");
    if (trimmed.includes("day")) return ago(number, "days");
    if (trimmed.includes("hour")) return ago(number, "hours");
    if (trimmed.includes("min")) return ago(number, "minutes");
    if (trimmed.includes("sec")) return ago(number, "seconds");
    return 0;
  }
}
