// Port of keiyoushi/extensions-source lib-multisrc/monochrome/MonochromeCMS.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate } from "../../sdk/index.ts";
import { cover, hasNext, parts, timestamp, title, type Chapter, type Manga, type Results } from "./api.ts";

export abstract class MonochromeCMS extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected get apiUrl(): string {
    return this.baseUrl.replace("://", "://api.");
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList());
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("Unsupported operation");
  }

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const it = (await this.client.get(`${this.apiUrl}/manga?limit=10&offset=${10 * (page - 1)}&title=${encodeURIComponent(query)}`)).parseAs<Results>();
    return new MangasPage(
      it.results.map((m) => this.mangaFromAPI(m)),
      hasNext(it),
    );
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/");
    if (url.hostname !== new URL(this.baseUrl).hostname || pathSegments.length < 2) return null;
    return this.mangaFromAPI((await this.client.get(`${this.apiUrl}/manga/${pathSegments[1]}`)).parseAs<Manga>());
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const chapterList = (await this.client.get(`${this.apiUrl}/manga/${manga.url}/chapters`)).parseAs<Chapter[]>().map((ch) => {
      const c = SChapter.create();
      c.name = title(ch);
      c.url = manga.url + parts(ch);
      c.chapter_number = ch.number;
      c.date_upload = timestamp(ch);
      c.scanlator = ch.scanGroup;
      return c;
    });
    return new SMangaUpdate(manga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const [uuid, version, length] = chapter.url.split("|");
    return Array.from({ length: Number(length) }, (_, i) => i + 1).map((it) => new Page(it, "", `${this.apiUrl}/media/${uuid}/${it}.jpg?version=${version}`));
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/chapters/${chapter.url.slice(37, 73)}`;
  }

  private mangaFromAPI(manga: Manga): SManga {
    const m = SManga.create();
    m.url = manga.id;
    m.title = manga.title;
    m.author = manga.author;
    m.artist = manga.artist;
    m.description = manga.description;
    m.thumbnail_url = this.apiUrl + cover(manga);
    switch (manga.status) {
      case "ongoing":
      case "hiatus":
        m.status = SManga.ONGOING;
        break;
      case "completed":
      case "cancelled":
        m.status = SManga.COMPLETED;
        break;
      default:
        m.status = SManga.UNKNOWN;
    }
    return m;
  }
}
