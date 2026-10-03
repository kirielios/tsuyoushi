// Port of keiyoushi/extensions-source src/en/egscomics/ElGoonishShive.kt
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain } from "../../../sdk/index.ts";

const THUMB = "https://static.tumblr.com/8cee5e83d26a8a96ad5e51b67f2e340e/j8ipbno/fXFoj0zh9/tumblr_static_1f2fhwjyya74gsgs888g8k880.png";
const BASE_DESC = "El Goonish Shive is a comic about a group of teenagers who face both real life and bizarre, supernatural situations. \n\nIt is a comedy mixed with drama and is recommended for audiences thirteen and older.";

export default class ElGoonishShive extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.US);

  private make(title: string, url: string, description: string): SManga {
    const manga = SManga.create();
    manga.title = title;
    manga.artist = "Dan Shive";
    manga.author = manga.artist;
    manga.status = SManga.ONGOING;
    manga.url = url;
    manga.description = description;
    manga.thumbnail_url = THUMB;
    manga.initialized = true;
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const manga = [
      this.make(this.name, "/comic/archive", BASE_DESC),
      this.make(`${this.name}: NewsPaper`, "/egsnp/archive", `${BASE_DESC} \n\nEGS:NP is a subsection with short stories that generally aren't canon unless stated`),
      this.make(`${this.name} Sketchbook`, "/sketchbook/archive", `${BASE_DESC} \n\nThe Sketchbook section is full of one-shot gags, sketches, comics that don't fit elsewhere.`),
    ];

    return new MangasPage(manga, false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const chapterList = document
      .select("select[name=comic] option[value~=^(comic|egsnp|sketchbook)]")
      .map((element) => {
        const chapter = SChapter.create();
        chapter.chapter_number = element.parent()!.children().indexOf(element);
        chapter.url = urlWithoutDomain(`/${element.attr("value")}`);
        // split(" - ", limit = 2)
        const text = element.text();
        const i = text.indexOf(" - ");
        const [first, last] = i < 0 ? [text, text] : [text.slice(0, i), text.slice(i + 3)];
        chapter.name = last;
        chapter.date_upload = this.dateFormat.tryParseDate(first);
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(manga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("#cc-comic").map((element, i) => new Page(i, "", element.absUrl("src")));
  }
}
