// Port of keiyoushi/extensions-source src/en/honkaiimpact/Honkaiimpact.kt
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type ClientBuilder, type Element, type FilterList } from "../../../sdk/index.ts";

// Port of Dto.kt
const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.US);

interface Dto {
  title: string;
  bookid: number;
  chapterid: number;
  timestamp: string;
}

function toSChapter(dto: Dto): SChapter {
  const chapter = SChapter.create();
  chapter.name = dto.title;
  chapter.url = `/book/${dto.bookid}/${Math.trunc(dto.chapterid)}`;
  chapter.date_upload = dateFormat.tryParseDateTime(dto.timestamp);
  chapter.chapter_number = dto.chapterid;
  return chapter;
}

export default class Honkaiimpact extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.connectTimeout(60_000).readTimeout(60_000);
  }

  // Popular
  async getPopularManga(_page: number): Promise<MangasPage> {
    const mangas = (await this.client.get(`${this.baseUrl}/book`)).asJsoup().select("a[href*=book]").map((it) => this.toSManga(it));
    return new MangasPage(mangas, false);
  }

  // Latest
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // Search
  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const mangas = (await this.client.get(`${this.baseUrl}/book`))
      .asJsoup()
      .select("a[href*=book]")
      .map((it) => this.toSManga(it))
      .filter((manga) => query.length === 0 || manga.title.toLowerCase().includes(query.trim().toLowerCase()));
    return new MangasPage(mangas, false);
  }

  // Manga details
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchMangaDetails(manga) : manga, fetchChapters ? this.fetchChapterList(manga) : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();
    const details = SManga.create();
    details.thumbnail_url = document.select("img.cover").attr("abs:src");
    details.description = document.select("div.detail_info1").text();
    details.title = document.select("div.title").text();
    return details;
  }

  // Chapter list
  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    return (await this.client.get(`${this.baseUrl}${manga.url}/get_chapter`)).parseAs<Dto[]>().map(toSChapter);
  }

  // Page list
  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.baseUrl + chapter.url)).asJsoup().select("img.lazy.comic_img").map((el, i) => new Page(i, "", el.attr("data-original")));
  }

  private toSManga(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.attr("abs:href"));
    manga.title = element.select(".container-title").text();
    manga.thumbnail_url = element.select(".container-cover img").attr("abs:src");
    return manga;
  }
}
