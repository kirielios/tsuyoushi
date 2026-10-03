// Port of keiyoushi/extensions-source src/en/readvagabondmanga/ReadVagabondManga.kt (+ Dto.kt)
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, tryParseInstant, type FilterList } from "../../../sdk/index.ts";

type MangaStatus = "ongoing" | "completed" | "hiatus";

interface ChapterDto {
  number: number;
  title: string;
  volume: number | null;
  mangaId: number;
  releaseDate: string;
  pageCount: number;
}

const chapterToSChapter = (c: ChapterDto): SChapter => {
  const chapter = SChapter.create();
  chapter.name = c.title;
  chapter.chapter_number = c.number;
  chapter.url = `/volume-${c.volume}/chapter-${c.number}/#${c.mangaId}`;
  chapter.date_upload = tryParseInstant(c.releaseDate);
  chapter.scanlator = "Read Vagabond Manga";
  return chapter;
};

interface MangaDto {
  id: number;
  title: string;
  author: string;
  artist: string;
  description: string;
  status?: MangaStatus;
  cover: string;
}

const mangaToSManga = (m: MangaDto): SManga => {
  const manga = SManga.create();
  manga.title = m.title;
  manga.url = `/#${m.id}`;
  manga.thumbnail_url = m.cover;
  manga.author = m.author;
  manga.artist = m.artist;
  manga.description = m.description;
  switch (m.status ?? "ongoing") {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
  }
  return manga;
};

export default class ReadVagabondManga extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const mangas = (await this.client.get(`${this.baseUrl}/api/mihon/mangas`)).parseAs<MangaDto[]>();
    return new MangasPage(mangas.map(mangaToSManga), false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/api/mihon/mangas`).newBuilder().addQueryParameter("q", query).addQueryParameter("page", String(page)).build();
    const mangas = (await this.client.get(url.toString())).parseAs<MangaDto[]>();
    return new MangasPage(mangas.map(mangaToSManga), false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const mangaId = toHttpUrl(`${this.baseUrl}${manga.url}`).fragment;

    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(`${this.baseUrl}/api/mihon/mangas/${mangaId}`).then((r) => mangaToSManga(r.parseAs<MangaDto>())) : manga,
      fetchChapters ? this.client.get(`${this.baseUrl}/api/mihon/mangas/${mangaId}/chapters`).then((r) => r.parseAs<ChapterDto[]>().map(chapterToSChapter)) : chapters,
    ]);

    return new SMangaUpdate(details, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const mangaId = toHttpUrl(`${this.baseUrl}${chapter.url}`).fragment;
    const chapterDto = (await this.client.get(`${this.baseUrl}/api/mihon/mangas/${mangaId}/chapters/${Math.trunc(chapter.chapter_number)}`)).parseAs<ChapterDto>();
    return Array.from({ length: chapterDto.pageCount }, (_, i) => new Page(i, "", `https://pub.moleve.net/chapter-${chapterDto.number}/page-${i + 1}.png`));
  }

  override getMangaUrl(_manga: SManga): string {
    return this.baseUrl;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/${chapter.url}`;
  }
}
