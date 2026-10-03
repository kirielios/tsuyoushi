// Port of keiyoushi/extensions-source src/all/sandraandwoo/SandraAndWoo.kt
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type Element, type FilterList } from "../../../sdk/index.ts";

const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT);

const CHAPTER_DATE_REGEX = /^.*\/(\d+)\/(\d+)\/(\d+)\/[^/]*\/$/;
const CHAPTER_TITLE_REGEX = /^Permanent Link:\s*((?:\[(\d{4})\])?\s*(?:\[[^\]]*(\d{4})\])?.*)$/;

export default class SandraAndWoo extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private readonly writer = "Oliver Knörzer";
  private readonly illustrator = "Powree";
  private readonly genres = "Comedy";
  private readonly state = SManga.ON_HIATUS;
  private readonly thumbnail = "https://www.sandraandwoo.com/images/fanart/fanart-contest-2014/pictures/zheng-qu-01-color-corrected.jpg";

  private get synopsis(): string {
    switch (this.lang) {
      case "de":
        return "Sandra und Woo ist ein Comedy-Webcomic mit dem zwölfjährigen Mädchen Sandra North und ihrem Waschbären Woo in den Hauptrollen. Zwar sollen die meisten Strips einfach nur lustig oder gewitzt sein, gelegentlich werden aber auch ernste Themen wie die Missachtung von Menschenrechten in Burma oder die Zerstörung der Natur angesprochen. Wir wollen außerdem zeigen, was es für Sandra und ihre Schulfreunde Cloud und Larisa bedeutet, erwachsen zu werden. Nicht vergessen werden sollten außerdem Woos Ausflüge in den nahen Wald um dort seine tierischen Freunde Shadow, ein Fuchs, und Sid, ein Eichhörnchen, zu treffen. Als weiteres Alleinstellungsmerkmal des Comics darf gelten, dass sich immer wieder einzelne Strips oder sogar längere Geschichten um die Nebenfiguren drehen.";
      default:
        return "Sandra and Woo is a comedy comic strip featuring the 13-year-old girl Sandra North and her mischievous pet raccoon Woo. While most strips are just supposed to be funny or tell an exciting story, some also deal with more serious topics. We also want to show what growing up means for Sandra and her best friends in middle school, Cloud and Larisa. Another regular feature of the comic are Woo’s trips to the forest to meet his furry friends Shadow (a fox) and Sid (a squirrel) and his love interest Lily.";
    }
  }

  private get archive(): string {
    return this.lang === "de" ? "/woode/archiv" : "/archive";
  }

  private get manga(): SManga {
    const manga = SManga.create();
    manga.title = this.name;
    manga.artist = this.illustrator;
    manga.author = this.writer;
    manga.description = this.synopsis;
    manga.genre = this.genres;
    manga.status = this.state;
    manga.thumbnail_url = this.thumbnail;
    manga.url = urlWithoutDomain(this.archive);
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.manga], false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const updatedChapters = fetchChapters ? await this.getChapterList(manga) : chapters;

    return new SMangaUpdate(this.manga, updatedChapters);
  }

  private roundHalfwayUp(x: number) {
    return (x + Math.floor(x + 1)) / 2;
  }

  private chapterParse(element: Element, lastChapterNumber: number): [number, SChapter] {
    const path = new URL(element.attr("href"), this.baseUrl).pathname;
    const dateMatch = CHAPTER_DATE_REGEX.exec(path);

    const date = dateMatch != null ? DATE_FORMAT.tryParseDate(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`) : 0;

    const hover = element.attr("title");
    const titleMatch = CHAPTER_TITLE_REGEX.exec(hover);

    const title = titleMatch?.[1] ?? hover;
    const number = titleMatch?.[2] ?? "";
    const backupNumber = titleMatch?.[3] ?? "";

    const chapterNumber = number.length > 0 ? Number.parseFloat(number) : backupNumber.length > 0 ? Number.parseFloat(backupNumber) : this.roundHalfwayUp(lastChapterNumber);

    const chapter = SChapter.create();
    chapter.url = path;
    chapter.name = title;
    chapter.chapter_number = chapterNumber;
    chapter.date_upload = date;

    return [chapterNumber, chapter];
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const elements = [...document.select("#column a")].reverse();

    // runningFold(initial) { previous, element -> chapterParse(element, previous.first) }.drop(1)
    let previous = 0;
    const chapters: SChapter[] = [];
    for (const element of elements) {
      const [n, chapter] = this.chapterParse(element, previous);
      previous = n;
      chapters.push(chapter);
    }
    return chapters.reverse();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const imgUrl = document.selectFirst("#comic img")?.absUrl("src") ?? "";

    return [new Page(0, "", imgUrl)];
  }
}
