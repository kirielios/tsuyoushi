// Port of keiyoushi/extensions-source src/en/readhorimiyaonline/ReadHorimiyaOnline.kt
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfter, substringBefore, urlWithoutDomain, type Document } from "../../../sdk/index.ts";

const DATE_FORMATTER = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH);

export default class ReadHorimiyaOnline extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  // ========================= Popular =========================
  async getPopularManga(_page: number): Promise<MangasPage> {
    const response = await this.client.get(this.baseUrl);
    return new MangasPage([this.parseMangaDetails(response.asJsoup())], false);
  }

  // ========================= Latest =========================
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ========================= Search =========================
  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    const response = await this.client.get(this.baseUrl);
    return new MangasPage([this.parseMangaDetails(response.asJsoup())], false);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return [];
  }

  // ========================= Details =========================
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const baseHost = substringBefore(substringAfter(this.baseUrl, "://"), "/");
    if (url.hostname !== baseHost) return null;
    const response = await this.client.get(this.baseUrl);
    return this.parseMangaDetails(response.asJsoup());
  }

  // ========================= Chapters + Update =========================
  async fetchMangaUpdate(_manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.baseUrl);
    const document = response.asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document), this.parseChapterList(document));
  }

  private parseChapterList(document: Document): SChapter[] {
    return document.select("div#chapter-list a.chapter-list-item").map((element) => {
      const chapter = SChapter.create();
      chapter.name = element.selectFirst("span.chapter-name")?.text() ?? element.text();
      chapter.date_upload = DATE_FORMATTER.tryParseDate(element.selectFirst("span.chapter-date")?.text());
      chapter.url = urlWithoutDomain(element.absUrl("href"));
      return chapter;
    });
  }

  // ========================= Pages =========================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(this.baseUrl + chapter.url);
    return this.parsePageList(response.asJsoup());
  }

  private parsePageList(document: Document): Page[] {
    return document.select("div.images-container img").map((img, i) => new Page(i, "", img.absUrl("src")));
  }

  // ========================= Helpers =========================
  private parseMangaDetails(doc: Document): SManga {
    const manga = SManga.create();
    manga.title = "Horimiya";
    manga.url = "/";
    manga.thumbnail_url = doc.selectFirst("img.manga-thumb")?.absUrl("src");
    manga.description = doc.selectFirst("span.desc")?.text();
    manga.genre = doc.select("span.genre-list-item").eachText().join(", ");
    manga.author = this.metaValue(doc, "Author(s)");
    manga.artist = this.metaValue(doc, "Artist(s)");
    switch (this.metaValue(doc, "Status")?.toLowerCase()) {
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
        manga.status = SManga.COMPLETED;
        break;
      case "hiatus":
        manga.status = SManga.ON_HIATUS;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    return manga;
  }

  private metaValue(doc: Document, label: string): string | undefined {
    return doc
      .select("div.extra-manga-info-left p")
      .find((it) => it.text().toLowerCase().startsWith(label.toLowerCase()))
      ?.selectFirst("span")
      ?.text();
  }
}
