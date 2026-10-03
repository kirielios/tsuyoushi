// Port of keiyoushi/extensions-source src/en/thegirlfromrandomchattingmangaonline/TheGirlFromRandomChattingMangaOnline.kt (+ Dto.kt)
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, tryParseInstant } from "../../../sdk/index.ts";

interface ChapterDto {
  title: string;
  date: string;
  url: string;
}

/** String.toFloat(): throws NumberFormatException */
function toFloat(s: string): number {
  const n = Number(s.trim());
  if (s.trim() === "" || Number.isNaN(n)) throw new Error(`NumberFormatException: ${s}`);
  return Math.fround(n);
}

function toSChapter(dto: ChapterDto): SChapter {
  const chapter = SChapter.create();
  // url looks like https://thegirlfromrandomchatting.com/manga/the-girl-from-random-chatting-chapter-96/
  chapter.url = new URL(dto.url).pathname.split("/").filter((s) => s.length > 0).at(-1)!;
  // title looks like : The Girl from Random Chatting, Chapter 351
  chapter.name = dto.title.split(", ")[1];
  chapter.chapter_number = toFloat(chapter.name.split(" ")[1]);
  chapter.date_upload = tryParseInstant(dto.date);
  return chapter;
}

export default class TheGirlFromRandomChattingMangaOnline extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([await this.createManga()], false);
  }

  override getMangaUrl(_manga: SManga): string {
    return this.baseUrl;
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage("the girl from random chatting".includes(query.toLowerCase()) ? [await this.createManga()] : [], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const updatedManga = fetchDetails ? await this.createManga() : manga;
    const updatedChapters = fetchChapters ? (await this.client.get(`${this.baseUrl}/wp-json/mg/v1/chapters-list`)).parseAs<ChapterDto[]>().map(toSChapter) : chapters;

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/manga/${chapter.url}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.getChapterUrl(chapter)))
      .asJsoup()
      .select("p > noscript > img")
      .map((img) => img.attr("src"))
      .map((src, i) => new Page(i, "", src));
  }

  private async createManga(): Promise<SManga> {
    const mainPage = (await this.client.get(this.baseUrl)).asJsoup();

    const manga = SManga.create();
    manga.url = "the-girl-from-random-chatting";
    manga.title = "The Girl from Random Chatting";
    manga.thumbnail_url = mainPage.selectFirst("figure.wp-block-gallery figure.wp-block-image:last-child noscript img")?.attr("src");
    manga.artist = "Eun Hyuk, Park";
    manga.author = "Eun Hyuk, Park";
    manga.status = SManga.COMPLETED;
    manga.description =
      "If you lived through – or are still living through – high school, you can relate to Joon-Woo. An outcast and a loner, his only joy comes from the hours he spends on his phone, randomly chatting with strangers. It’s all weird and meaningless, until Joon-Woo strikes gold – as he’s matched in a private chat with a pretty young girl his age. Jackpot! But when he discovers that this same pretty girl is actually his classmate Seung Ah, things get a little too real for a guy who’s never even remotely been kissed.\n(sourced from Webtoon)";
    manga.genre = "Action, Drama, Comedy, Romance, Slice of Life, Shounen, Harem";

    // Source has already uploaded all chapters of the completed manga
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK

    // Details are provided with the first request so this prevents refetching them by themselves in fetchMangaUpdate
    manga.initialized = true;
    return manga;
  }
}
