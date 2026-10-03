// Port of keiyoushi/extensions-source src/id/komiku/Komiku.kt
import {
  DateTimeFormatter,
  FilterList,
  GET,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type HttpUrlBuilder,
  type Request,
} from "../../../sdk/index.ts";
import { Genre1, Genre2, Order, Status, Type, isUriFilter } from "./filters.ts";

export default class Komiku extends KeiSource {
  private readonly apiUrl = "https://api.komiku.org";

  protected override configureClient(builder: ClientBuilder) {
    return builder.addInterceptor((request) => this.headersInterceptor(request)).rateLimit(2);
  }

  protected override configureHeaders(headers: Headers) {
    headers.set("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7");
    return headers;
  }

  // ============================== Popular ===============================
  async getPopularManga(page: number): Promise<MangasPage> {
    const url = (page > 1 ? toHttpUrl(`${this.apiUrl}/other/hot/page/${page}/`) : toHttpUrl(`${this.apiUrl}/other/hot/`)).newBuilder().addQueryParameter("orderby", "meta_value_num").build();

    return this.mangaListParse((await this.client.get(url.toString())).asJsoup());
  }

  // =============================== Latest ===============================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.mangaApiUrlBuilder(page).addQueryParameter("orderby", "modified").build();
    return this.mangaListParse((await this.client.get(url.toString())).asJsoup());
  }

  // =============================== Search ===============================
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = this.mangaApiUrlBuilder(page);
    if (query) builder.addQueryParameter("s", query);
    filters.filter(isUriFilter).forEach((it) => it.addToUri(builder));

    return this.mangaListParse((await this.client.get(builder.build().toString())).asJsoup());
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const pathSegments = url.pathname.slice(1).split("/");
    if (pathSegments[0] !== "manga") return null;
    const slug = pathSegments[1];
    if (!slug) return null;
    const targetUrl = `${this.baseUrl}/manga/${slug}/`;
    const document = (await this.client.get(targetUrl)).asJsoup();
    const manga = SManga.create();
    manga.url = urlWithoutDomain(targetUrl);
    // Not upstream: parseDetails never sets the title (Kotlin's lateinit would throw), so a pasted URL came back untitled.
    manga.title = document.selectFirst("#Judul h1 span[itemprop=name]")?.text() ?? "";
    return this.parseDetails(document, manga);
  }

  private mangaApiUrlBuilder(page: number): HttpUrlBuilder {
    const b = toHttpUrl(this.apiUrl).newBuilder();
    b.addPathSegment("manga");
    if (page > 1) b.addPathSegments(`page/${page}`);
    return b;
  }

  // ======================= Details and Chapters ==========================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();
    return new SMangaUpdate(this.parseDetails(document, manga), this.parseChapters(document));
  }

  private parseDetails(document: Document, manga: SManga): SManga {
    let description = document.select("#Sinopsis > p, p.desc[itemprop=description]").text();
    const alt = document.selectFirst("table.inftable tr:contains(Judul Indonesia) td + td, table.inftable tr:contains(Judul Alternatif) td + td")?.text();
    if (alt) {
      if (description) description += "\n\n";
      description += `Judul Alternatif: ${alt}`;
    }
    manga.description = description;

    manga.author = document.selectFirst("table.inftable td:contains(Pengarang)+td, table.inftable td:contains(Komikus)+td, table.inftable td:contains(Author)+td")?.text();
    manga.genre =
      document
        .select("ul.genre li.genre a span")
        .map((it) => it.text())
        .join(", ") || undefined;
    manga.status = this.parseStatus(document.selectFirst("table.inftable tr > td:contains(Status) + td")?.text());
    const thumb = document.selectFirst("div.ims > img, img[itemprop=image]")?.absUrl("src");
    manga.thumbnail_url = thumb != null ? removeQuery(thumb) : undefined;
    return manga;
  }

  private parseStatus(status: string | undefined): number {
    if (status == null) return SManga.UNKNOWN;
    const s = status.toLowerCase();
    if (s.includes("ongoing") || s.includes("on going")) return SManga.ONGOING;
    if (s.includes("end") || s.includes("completed") || s.includes("tamat")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  private parseChapters(document: Document): SChapter[] {
    return document.select("#Daftar_Chapter tr:has(td.judulseries)").map((element) => {
      const chapter = SChapter.create();
      const a = element.selectFirst("a")!;
      chapter.url = urlWithoutDomain(a.absUrl("href"));
      chapter.name = a.text();

      const timeStamp = element.selectFirst("td.tanggalseries")?.text() ?? "";
      chapter.date_upload = timeStamp.includes("lalu") ? this.parseRelativeDate(timeStamp) : this.dateFormat.tryParseDate(timeStamp, "Asia/Jakarta");
      return chapter;
    });
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("dd/MM/yyyy");

  private parseRelativeDate(date: string): number {
    const trimmedDate = date.split(" lalu")[0].trim().split(" ");
    if (trimmedDate.length < 2) return 0;
    if (!/^[+-]?\d+$/.test(trimmedDate[0])) return 0; // toIntOrNull
    const amount = Number(trimmedDate[0]);

    // Calendar.getInstance(): local time
    const calendar = new Date();
    switch (trimmedDate[1]) {
      case "detik":
        calendar.setSeconds(calendar.getSeconds() - amount);
        break;
      case "menit":
        calendar.setMinutes(calendar.getMinutes() - amount);
        break;
      case "jam":
        calendar.setHours(calendar.getHours() - amount);
        break;
      case "hari":
        calendar.setDate(calendar.getDate() - amount);
        break;
      case "minggu":
        calendar.setDate(calendar.getDate() - amount * 7);
        break;
      case "bulan":
        calendar.setMonth(calendar.getMonth() - amount);
        break;
      case "tahun":
        calendar.setFullYear(calendar.getFullYear() - amount);
        break;
    }
    return calendar.getTime();
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = this.baseUrl + chapter.url;
    const document = (await this.client.get(chapterUrl)).asJsoup();
    return document
      .select("#Baca_Komik img")
      .filter((it) => !it.attr("src").includes("komiku-promosi"))
      .map((element, i) => new Page(i, chapterUrl, element.attr("abs:src")));
  }

  override imageRequest(page: Page): Request {
    const headers = this.headersBuilder();
    headers.set("Referer", page.url);
    return GET(page.imageUrl!, headers);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Type(), new Order(), new Genre1(), new Genre2(), new Status());
  }

  // ============================= Utilities ==============================
  private headersInterceptor(request: Request): Request {
    const url = new URL(request.url);
    const urlString = request.url;

    if (urlString.includes("komiku.org") || urlString.includes("komikid.org") || urlString.includes("komiku.to")) {
      const newHeaders = new Headers(request.headers);
      newHeaders.delete("X-Requested-With");
      newHeaders.set("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7");

      if (url.host.includes("img") || url.host.includes("thumbnail") || url.host.includes("update") || url.host.includes("image")) {
        const referer = request.headers.get("Referer");
        if (referer == null || !referer.includes(this.baseUrl)) newHeaders.set("Referer", `${this.baseUrl}/`);
        newHeaders.set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
        newHeaders.set("Sec-Fetch-Dest", "image");
        newHeaders.set("Sec-Fetch-Mode", "no-cors");
        newHeaders.set("Sec-Fetch-Site", urlString.includes("komiku.org") ? "same-site" : "cross-site");
      }

      return { ...request, headers: newHeaders };
    }

    return request;
  }

  private mangaListParse(document: Document): MangasPage {
    const mangas = document.select("div.bge").map((element) => {
      const manga = SManga.create();
      manga.title = element.selectFirst("h3")!.text();
      manga.url = urlWithoutDomain(element.selectFirst("a:has(h3)")!.absUrl("href"));
      const thumb = element.selectFirst("img")?.absUrl("src");
      manga.thumbnail_url = thumb != null ? removeQuery(thumb) : undefined;
      return manga;
    });
    const hasNextPage = document.selectFirst("span[hx-get]") != null || mangas.length >= 10;
    return new MangasPage(mangas, hasNextPage);
  }
}

/** String.removeQuery(): toHttpUrlOrNull()?.newBuilder()?.query(null) */
function removeQuery(s: string): string {
  const url = toHttpUrlOrNull(s)?.toURL();
  if (!url) return s;
  url.search = "";
  return url.href;
}
