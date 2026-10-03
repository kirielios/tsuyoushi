// Port of keiyoushi/extensions-source src/en/randowiz/Randowiz.kt
import { DateTimeFormatter, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

const dateFormat = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.ENGLISH);

export default class Randowiz extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const make = (title: string, url: string, description: string, thumbnail_url: string): SManga => ({
      ...SManga.create(),
      title,
      artist: "Randowiz",
      author: "Randowiz",
      status: SManga.ONGOING,
      url,
      description,
      thumbnail_url,
    });
    return new MangasPage(
      [
        make("Randowiz: We live in an MMO!?", "/category/we-live-in-an-mmo/", "The world of 'Mamuon' where players and NPC's live together in harmony. Or do they? DO THEY?", "https://i0.wp.com/randowis.com/wp-content/uploads/2016/02/MMO_CHP_001_CSP_000.jpg?resize=800%2C800&ssl=1"),
        make("Randowiz: Short comics", "/category/short-comics/", "So short that i have to compensate..", "https://i0.wp.com/randowis.com/wp-content/uploads/2021/10/Images_PNGs_Site_BOT-SUPPORT.png"),
        make("Randowiz: Illustations", "/category/art/", "You like draw? I give you draw.", "https://i0.wp.com/randowis.com/wp-content/uploads/2021/05/colour-studies-021-post.jpg"),
      ],
      false,
    );
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage(
      (await this.getPopularManga(page)).mangas.filter((manga) => manga.title.toLowerCase().includes(query.toLowerCase())),
      false,
    );
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const chapterList: SChapter[] = [];
    let currentDocument = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    while (true) {
      for (const element of currentDocument.select(".has-post-thumbnail")) {
        const chapter = SChapter.create();
        const linkTag = element.selectFirst(".elementor-post__title a")!;
        chapter.name = linkTag.text();
        chapter.url = urlWithoutDomain(linkTag.absUrl("href"));
        chapter.date_upload = dateFormat.tryParseDate(element.selectFirst(".elementor-post-date")?.text());
        chapterList.push(chapter);
      }

      const nextUrl = currentDocument.selectFirst(".next")?.absUrl("href");
      if (!nextUrl) break;

      currentDocument = (await this.client.get(nextUrl)).asJsoup();
    }

    chapterList.forEach((chapter, i) => {
      chapter.chapter_number = chapterList.length - i;
    });
    return new SMangaUpdate(manga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.getChapterUrl(chapter))).asJsoup().select(".elementor-widget-theme-post-content img").map((img, index) => new Page(index, "", img.absUrl("src")));
  }
}
