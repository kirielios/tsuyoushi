// Port of keiyoushi/extensions-source src/en/darklegacycomics/DarkLegacyComics.kt
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, distinctBy } from "../../../sdk/index.ts";

const THUMB_URL = "https://images2.imgbox.com/5d/d8/BVxRdljH_o.png";
const AUTHOR_NAME = "Arad Kedar (Keydar)";
const SPECIALS_DATE = 1399926480000; // 2014-05-12 23:28
const specials: [number, string][] = [
  [1, "Looking For Group"],
  [2, "Rover"],
  [3, "Fan Comic"],
];
const dateFormat = DateTimeFormatter.ofPattern("[MMMM][MMM] d, yyyy", Locale.ENGLISH);

/** String.toFloat(): throws NumberFormatException */
function toFloat(s: string): number {
  const n = Number(s.trim());
  if (s.trim() === "" || Number.isNaN(n)) throw new Error(`NumberFormatException: ${s}`);
  return Math.fround(n);
}

export default class DarkLegacyComics extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const main = SManga.create();
    main.url = "/archive";
    main.title = "Dark Legacy Comics";
    main.thumbnail_url = THUMB_URL;
    main.status = SManga.ONGOING;
    main.author = AUTHOR_NAME;
    main.artist = AUTHOR_NAME;
    const sp = SManga.create();
    sp.url = "/specials/1.php";
    sp.title = "Dark Legacy Comics Specials";
    sp.thumbnail_url = THUMB_URL;
    sp.status = SManga.COMPLETED;
    sp.author = AUTHOR_NAME;
    sp.artist = AUTHOR_NAME;
    return new MangasPage([main, sp], false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  getSearchMangaList(page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return this.getPopularManga(page);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    let updatedChapters: SChapter[];
    if (manga.url === "/archive") {
      // The archive lists every comic twice (ascending and descending) for its JS reorder toggle
      const list = (await this.client.get(this.baseUrl + manga.url)).asJsoup().select(".archive_link").map((it) => {
        const index = it.selectFirst(".index")!.text();
        const date = it.selectFirst(".date")!.ownText();
        const title = it.selectFirst(".name")!.text();
        const characters = it.select(".characters").text();
        const chapter = SChapter.create();
        chapter.url = `/${index}`;
        chapter.name = `#${index}: ${title}`;
        chapter.chapter_number = toFloat(index);
        // Not actually scanlators but whatever
        chapter.scanlator = characters.replaceAll(" ", ", ");
        // One of the dates is missing the year
        chapter.date_upload = date === "Sep 20" ? 1442696400000 : dateFormat.tryParseDate(date); // Sep 20, 2015
        return chapter;
      });
      updatedChapters = distinctBy(list, (it) => it.url).sort((a, b) => b.chapter_number - a.chapter_number);
    } else {
      updatedChapters = specials
        .map(([key, value]) => {
          const chapter = SChapter.create();
          chapter.name = value;
          chapter.url = `/specials/${key}`;
          chapter.chapter_number = key;
          chapter.date_upload = SPECIALS_DATE;
          return chapter;
        })
        .reverse();
    }

    return new SMangaUpdate(manga, updatedChapters);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.baseUrl + chapter.url)).asJsoup().select(".comic > img").map((img, idx) => new Page(idx, "", img.absUrl("src")));
  }
}
