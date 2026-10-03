// Port of keiyoushi/extensions-source src/all/mayotune/MayoTune.kt (+ ChapterDto.kt)
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, isNotBlank, toHttpUrl, tryParseInstant, type FilterList } from "../../../sdk/index.ts";

interface ChapterDto {
  id: string;
  title: string;
  number: number;
  pageCount: number;
  date: string;
}

const getChapterURL = (c: ChapterDto, chapterEndpoint: string) => `/api/${chapterEndpoint}/chapters?id=${c.id}&number=${getNumberStr(c)}`;
const getNumberStr = (c: ChapterDto) => String(c.number); // Kotlin prints whole numbers as Int; JS already does
const getChapterTitle = (c: ChapterDto) => (isNotBlank(c.title) ? `Chapter ${getNumberStr(c)}: ${c.title}` : `Chapter ${getNumberStr(c)}`);
const getDateTimestamp = (c: ChapterDto) => tryParseInstant(c.date);

const names: Record<string, string> = {
  en: "Tune In to the Midnight Heart",
  ja: "真夜中ハートチューン",
  all: "Mayonaka Heart Tune",
};

export default class MayoTune extends KeiSource {
  private get chapterEndpoint(): string {
    return this.lang === "ja" ? "raw" : "";
  }

  private get source(): SManga {
    const manga = SManga.create();
    manga.title = names[this.lang] ?? names.all;
    manga.url = "/";
    manga.thumbnail_url = `${this.baseUrl}/img/cover.jpg`;
    manga.author = "Masakuni Igarashi";
    return manga;
  }

  // Popular
  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.source], false);
  }

  // Latest
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    return new MangasPage([this.source], false);
  }

  // Search
  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const mangas: SManga[] = [];
    const q = query.toLowerCase();
    const source = this.source;

    if (Object.values(names).some((it) => it.toLowerCase().includes(q)) || source.author?.toLowerCase().includes(q) === true) {
      mangas.push(source);
    }

    return new MangasPage(mangas, false);
  }

  override getChapterUrl(chapter: SChapter): string {
    const id = toHttpUrl(this.baseUrl + chapter.url).queryParameter("id");
    return `${this.baseUrl}/${this.chapterEndpoint}/chapter/${id}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchDetails() : manga, fetchChapters ? this.fetchChapterList() : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  // Details
  private async fetchDetails(): Promise<SManga> {
    const source = this.source;
    const document = (await this.client.get(this.baseUrl + source.url)).asJsoup();
    const statusText = document.selectFirst("div.text-center:contains(Status)")?.text()?.split("Status")[0]?.trim();

    const manga = SManga.create();
    manga.url = source.url;
    manga.title = source.title;
    manga.artist = source.artist;
    manga.author = source.author;
    manga.description = document.selectFirst(".text-lg")?.text();
    manga.genre = document.selectFirst("span.text-sm:nth-child(2)")?.text()?.replaceAll("•", ",");
    switch (statusText) {
      case "Ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "Completed":
        manga.status = SManga.COMPLETED;
        break;
      case "Cancelled":
        manga.status = SManga.CANCELLED;
        break;
      case "Hiatus":
        manga.status = SManga.ON_HIATUS;
        break;
      case "Finished":
        manga.status = SManga.PUBLISHING_FINISHED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    const thumb = document.selectFirst("img.object-contain")?.absUrl("src");
    manga.thumbnail_url = thumb == null ? undefined : thumb === "" ? source.thumbnail_url : thumb;
    return manga;
  }

  // Chapters
  private async fetchChapterList(): Promise<SChapter[]> {
    const chapters = (await this.client.get(`${this.baseUrl}/api/${this.chapterEndpoint}/chapters`)).parseAs<ChapterDto[]>();
    return [...chapters]
      .sort((a, b) => b.number - a.number)
      .map((c) => {
        const chapter = SChapter.create();
        chapter.url = getChapterURL(c, this.chapterEndpoint);
        chapter.name = getChapterTitle(c);
        chapter.chapter_number = c.number;
        chapter.date_upload = getDateTimestamp(c);
        return chapter;
      });
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterDto = (await this.client.get(this.baseUrl + chapter.url)).parseAs<ChapterDto>();
    return Array.from({ length: chapterDto.pageCount }, (_, index) => new Page(index, "", `${this.baseUrl}/api/manga/${chapterDto.id}/${index + 1}`));
  }
}
