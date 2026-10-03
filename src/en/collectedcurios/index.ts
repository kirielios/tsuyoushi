// Port of keiyoushi/extensions-source src/en/collectedcurios/Collectedcurios.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfter } from "../../../sdk/index.ts";

const toIntOrNull = (s: string | null | undefined): number | null => (s != null && /^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null);

const AUTHOR = "Jolly Jack aka Phillip M Jackson";

function make(title: string, url: string, description: string, thumbnail_url: string): SManga {
  const manga = SManga.create();
  manga.title = title;
  manga.artist = AUTHOR;
  manga.author = AUTHOR;
  manga.status = SManga.ONGOING;
  manga.url = url;
  manga.description = description;
  manga.thumbnail_url = thumbnail_url;
  return manga;
}

export default class Collectedcurios extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  // ============================== Popular ===============================
  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage(
      [
        make("Sequential Art", "/sequentialart.php", "Sequential Art webcomic.", "https://www.collectedcurios.com/images/CC_2011_Sequential_Art_Button.jpg"),
        make("Battle Bunnies", "/battlebunnies.php", "Battle Bunnies webcomic.", "https://www.collectedcurios.com/images/CC_2011_Battle_Bunnies_Button.jpg"),
        make("Spider and Scorpion", "/spiderandscorpion.php", "Spider and Scorpion webcomic.", "https://www.collectedcurios.com/images/CC_2011_Spider_And_Scorpion_Button.jpg"),
      ],
      false,
    );
  }

  // =============================== Latest ===============================
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // =============================== Search ===============================
  getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return this.getPopularManga(1);
  }

  // ============================== Chapters ==============================
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const responseJs = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const back = toIntOrNull(substringAfter(responseJs.selectFirst("img[title=Back one]")?.parent()?.attr("href") ?? "", "="));
    const lastChapter =
      toIntOrNull(responseJs.selectFirst("img[title=Last]")?.parent()?.attr("href") == null ? null : substringAfter(responseJs.selectFirst("img[title=Last]")!.parent()!.attr("href"), "=")) ??
      toIntOrNull(responseJs.selectFirst("input[title=Jump to number]")?.attr("value")) ??
      (responseJs.selectFirst("img[title=Back one]")?.parent() != null && back != null ? back + 1 : null) ??
      1;

    const chapterList: SChapter[] = [];
    for (let i = lastChapter; i >= 1; i--) {
      const chapter = SChapter.create();
      chapter.url = `${manga.url}?s=${i}`;
      chapter.name = `Chapter - ${i}`;
      chapter.chapter_number = i;
      chapter.date_upload = 0;
      chapterList.push(chapter);
    }

    return new SMangaUpdate(manga, chapterList);
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    return [new Page(0, this.baseUrl + chapter.url)];
  }

  override async getImageUrl(page: Page): Promise<string> {
    const url = page.url;
    const document = (await this.client.get(url)).asJsoup();

    if (url.includes("sequentialart")) return document.selectFirst(".w3-image")!.absUrl("src");
    if (url.includes("battlebunnies") || url.includes("spiderandscorpion")) return document.selectFirst("#strip")!.absUrl("src");
    throw new Error("Could not find the image");
  }
}
