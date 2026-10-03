// Port of keiyoushi/extensions-source src/en/broccolisoup/BroccoliSoup.kt
import {
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  substringAfterLast,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type FilterList,
} from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";

const characterSummaryPathSlug = "comic-characters";

export default class BroccoliSoup extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor(TextInterceptor());
  }

  // Popular
  private createManga(): SManga {
    const manga = SManga.create();
    manga.title = "Broccoli Soup";
    manga.url = "/comic/archive";
    manga.author = "Secret Pie";
    manga.artist = manga.author;
    manga.description = " Hello there! How is the Weather? This comic is made by me, Secret Pie. I am a pie with legs who draws comics and makes music. I am also an entomologist.";
    manga.thumbnail_url = "https://politeandgood.com/assets/images/static/Bocki%20(correct%20size).png";
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.createManga()], false);
  }

  // Latest
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // Search
  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  // Details
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const chapterList = fetchChapters ? this.chapterListParse((await this.client.get(this.getMangaUrl(manga))).asJsoup()) : chapters;
    return new SMangaUpdate(this.createManga(), chapterList);
  }

  // Chapters
  private createCharacterSummaryChapter(): SChapter {
    const chapter = SChapter.create();
    chapter.url = `/${characterSummaryPathSlug}`;
    chapter.name = "Characters";
    chapter.chapter_number = 0;
    return chapter;
  }

  private chapterListParse(document: Document): SChapter[] {
    // Keep track of the last-used chapter number in each "arc" of chapters
    const arcIndexMap = new Map<string, number>();

    // Add the character summary page as a chapter
    const chaptersList: SChapter[] = [this.createCharacterSummaryChapter()];

    for (const groupElement of document.select("li.archive-marker")) {
      const arcTitle = groupElement.selectFirst(".archive-header .marker-title")?.text();
      for (const chapterElement of groupElement.select("li.archive-page")) {
        // Skip chapters elements that are missing the required subelements
        const linkElement = chapterElement.selectFirst("a");
        if (!linkElement) continue;
        const titleElement = linkElement.selectFirst("span.page-title");
        if (!titleElement) continue;

        const url = linkElement.attr("href");
        const lastSegment = substringAfterLast(url, "/");
        const chapterNumber = /^[+-]?\d+$/.test(lastSegment) ? Number.parseInt(lastSegment, 10) : null;

        // Construct a title from the chapter number, chapter title, arc title, and
        // the chapter number within the current arc.
        // E.g. "98: Apologetics (VOID #43)"
        const parts: string[] = [];
        if (chapterNumber !== null) parts.push(`${chapterNumber}:`);
        parts.push(titleElement.text());
        if (arcTitle !== undefined) {
          const newIndex = 1 + (arcIndexMap.get(arcTitle) ?? 0);
          arcIndexMap.set(arcTitle, newIndex);
          parts.push(`(${arcTitle} #${newIndex})`);
        }

        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(url);
        chapter.name = parts.join(" ");
        // Set the chapter number if we have one
        if (chapterNumber !== null) chapter.chapter_number = chapterNumber;
        // The chapter list doesn't have the upload date, so we can't set them
        chaptersList.push(chapter);
      }
    }
    // Reverse the list since "source" ordering is expected to have the latest
    // chapter first in the list.
    return chaptersList.reverse();
  }

  // Pages
  private characterSummaryPageListParse(document: Document): Page[] {
    return document.select("section.static-block:has(figure, .block-content)").flatMap((sectionElement) => {
      const headerText = sectionElement.selectFirst("section > :is(h1, h2, h3, h4)")?.text().trim();
      const bodyText = sectionElement.selectFirst("div.block-content")?.text().trim();
      const imageUrl = sectionElement.selectFirst("figure img")?.attr("abs:src");

      let pageIndex = 0;
      const pages: Page[] = [];
      // The character's name and summary
      if (headerText !== undefined || bodyText !== undefined) {
        const textUrl = TextInterceptorHelper.createUrl(headerText ?? "", bodyText ?? "");
        pages.push(new Page(pageIndex++, "", textUrl));
      }
      // The character's image
      if (imageUrl !== undefined) pages.push(new Page(pageIndex++, "", imageUrl));
      return pages;
    });
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(this.getChapterUrl(chapter));
    const isCharacterSummary = HttpUrl.parse(response.url).pathSegments.at(-1) === characterSummaryPathSlug;
    const document = response.asJsoup();

    // The character summary page needs special parsing
    if (isCharacterSummary) return this.characterSummaryPageListParse(document);

    return document.select("#comic img").map((element, index) => new Page(index, "", element.attr("abs:src")));
  }
}
