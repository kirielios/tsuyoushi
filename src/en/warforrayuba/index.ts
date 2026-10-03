// Port of keiyoushi/extensions-source src/en/warforrayuba/WarForRayuba.kt (+ dto/*.kt)
import {
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  type ClientBuilder,
  type FilterList,
} from "../../../sdk/index.ts";

// ---- dto/*.kt
interface GithubFileDto {
  name: string;
  download_url: string;
}
interface ChapterDto {
  title: string;
  volume: number;
  groups: { primary: string };
  last_updated: number;
}
interface RoundDto {
  title: string;
  description: string;
  artist: string;
  author: string;
  cover: string;
  chapters: Record<string, ChapterDto>;
}
interface PageDto {
  description: string;
  src: string;
}

export default class WarForRayuba extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(4);
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:86.0) Gecko/20100101 Firefox/86.0 ");
    return headers;
  }

  // Upstream builds "(Android <release>; <manufacturer> <model>) Tachiyomi/<version> <build id>" from the device
  private readonly cubariHeaders = new Headers({ "User-Agent": "(Android 14; Google Pixel 8) Tachiyomi/0.19.0 UP1A.231005.007" });

  async getPopularManga(_page: number): Promise<MangasPage> {
    const response = (await this.client.get("https://api.github.com/repos/xrabohrok/WarMap/contents/tools")).parseAs<GithubFileDto[]>();
    const mangaList = response
      .filter((it) => it.name.endsWith(".json"))
      .map((it) => {
        const manga = SManga.create();
        manga.title = it.name;
        manga.url = it.download_url;
        return manga;
      });
    return new MangasPage(mangaList, false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const roundDto = (await this.client.get(manga.url)).parseAs<RoundDto>();

    const details = SManga.create();
    details.title = roundDto.title;
    details.description = roundDto.description;
    details.thumbnail_url = roundDto.cover;
    details.author = roundDto.author;
    details.artist = roundDto.artist;

    const chapters = Object.entries(roundDto.chapters)
      .map(([number, chapter]) => {
        const c = SChapter.create();
        c.url = "https://cubari.moe" + chapter.groups.primary;
        c.chapter_number = Number.parseInt(number, 10);
        c.name = number + " " + chapter.title;
        c.date_upload = chapter.last_updated;
        return c;
      })
      .reverse();

    return new SMangaUpdate(details, chapters);
  }

  override getMangaUrl(_manga: SManga): string {
    return this.baseUrl;
  }

  override getChapterUrl(chapter: SChapter): string {
    return chapter.url;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterData = (await this.client.get(chapter.url, this.cubariHeaders)).parseAs<PageDto[]>();
    // page.src.slice(0..page.src.lastIndexOf(".")): up to and including the last dot (empty when there is none)
    return chapterData.map((page, index) => new Page(index, page.src.slice(0, page.src.lastIndexOf(".") + 1), page.src));
  }
}
