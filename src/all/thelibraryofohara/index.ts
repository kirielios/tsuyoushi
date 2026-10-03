// Port of keiyoushi/extensions-source src/all/thelibraryofohara/TheLibraryOfOhara.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, tryParseInstant, urlWithoutDomain, type Element } from "../../../sdk/index.ts";

const reverieLangRegex = /(French|Arabic|Italian|Indonesia|Spanish)/;

export default class TheLibraryOfOhara extends KeiSource {
  private get siteLang(): string {
    switch (this.lang) {
      case "id":
        return "Indonesia";
      case "en":
        return "English";
      case "es":
        return "Spanish";
      case "it":
        return "Italian";
      case "ar":
        return "Arabic";
      case "fr":
        return "French";
      default:
        return this.lang;
    }
  }

  override get supportsLatest() {
    return false;
  }

  // Popular

  private popularMangaSelector(): string {
    switch (this.lang) {
      case "en":
        return (
          "#categories-7 ul li.cat-item-589813936," + // Chapter Secrets
          "#categories-7 ul li.cat-item-607613583, " + // Chapter Secrets Specials
          "#categories-7 ul li.cat-item-43972770, " + // Charlotte Family
          "#categories-7 ul li.cat-item-9363667, " + // Complete Guides
          "#categories-7 ul li.cat-item-634609261, " + // Parody Chapter
          "#categories-7 ul li.cat-item-699200615, " + // Return to the Reverie
          "#categories-7 ul li.cat-item-139757, " + // SBS
          "#categories-7 ul li.cat-item-22695, " + // Timeline
          "#categories-7 ul li.cat-item-648324575"
        );

      // Vivre Card Databook
      case "id":
        return "#categories-7 ul li.cat-item-702404482, #categories-7 ul li.cat-item-699200615";

      // Chapter Secrets Bahasa Indonesia, Return to the Reverie
      case "fr":
        return "#categories-7 ul li.cat-item-699200615";

      // Return to the Reverie
      case "ar":
        return "#categories-7 ul li.cat-item-699200615";

      // Return to the Reverie
      case "it":
        return "#categories-7 ul li.cat-item-699200615";

      // Return to the Reverie
      default:
        return "#categories-7 ul li.cat-item-693784776, #categories-7 ul li.cat-item-699200615"; // Chapter Secrets (multilingual), Return to the Reverie
    }
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    const mangas = document.select(this.popularMangaSelector()).map((element) => {
      const manga = SManga.create();
      manga.title = element.select("a").text();
      manga.url = urlWithoutDomain(element.select("a").attr("abs:href"));
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  // Latest - not supported

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // Search

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage(
      (await this.getPopularManga(1)).mangas.filter((it) => it.title.toLowerCase().includes(query.toLowerCase())),
      false,
    );
  }

  // Details

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const title = document.select("h1.page-title").text().replace("Category: ", "");

    manga.title = title;
    manga.thumbnail_url = this.chooseChapterThumbnail(document, title) ?? undefined;
    manga.description = "";
    manga.status = SManga.ONGOING;

    return new SMangaUpdate(manga, fetchChapters ? await this.getChapterList(document) : chapters);
  }

  // Use one of the chapter thumbnails as manga thumbnail
  // Some thumbnails have a flag on them which indicates the Language.
  // Try to choose a thumbnail with a matching flag
  private chooseChapterThumbnail(document: Element, mangaTitle: string): string | null {
    let imgElement: Element | null = null;

    // Reverie
    if (mangaTitle.includes("Reverie")) {
      imgElement =
        document.select("article").find((element) => {
          const chapterTitle = element.select("h2.entry-title a").text();
          return chapterTitle.includes(this.siteLang) || (this.lang === "en" && !reverieLangRegex.test(chapterTitle));
        }) ?? null;
    }
    // Chapter Secrets (multilingual)
    if (mangaTitle.includes("Chapter Secrets") && this.lang !== "en") {
      imgElement =
        document.select("article").find((it) => {
          const chapterTitle = it.select("h2.entry-title a").text();
          return (this.lang === "id" && chapterTitle.includes("Indonesia")) || (this.lang === "es" && !chapterTitle.includes("Indonesia"));
        }) ?? null;
    }

    // Fallback
    imgElement = imgElement ?? document.select("article:first-of-type").first();
    return imgElement ? imgElement.select("img").attr("abs:src") : null;
  }

  // Chapters

  private chapterNextPageSelector() {
    return "div.nav-previous a";
  }

  private async getChapterList(firstPage: Element): Promise<SChapter[]> {
    const allChapters: SChapter[] = [];
    let document = firstPage;

    for (;;) {
      const pageChapters = document.select("article").map((element) => {
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(element.select("a.entry-thumbnail").attr("abs:href"));
        chapter.name = element.select("h2.entry-title a").text();
        chapter.date_upload = tryParseInstant(element.select("span.posted-on time").attr("datetime"));
        return chapter;
      });
      if (pageChapters.length === 0) break;

      allChapters.push(...pageChapters);

      const nextLink = document.select(this.chapterNextPageSelector());
      if (nextLink.isEmpty()) break;

      const nextUrl = nextLink.attr("abs:href");
      document = (await this.client.get(nextUrl)).asJsoup();
    }

    if (allChapters.length > 0 && allChapters[0].name.includes("Reverie")) {
      switch (this.lang) {
        case "fr":
          return allChapters.filter((it) => it.name.includes("French"));
        case "ar":
          return allChapters.filter((it) => it.name.includes("Arabic"));
        case "it":
          return allChapters.filter((it) => it.name.includes("Italian"));
        case "id":
          return allChapters.filter((it) => it.name.includes("Indonesia"));
        case "es":
          return allChapters.filter((it) => it.name.includes("Spanish"));
        default:
          return allChapters.filter((it) => !it.name.includes("French") && !it.name.includes("Arabic") && !it.name.includes("Italian") && !it.name.includes("Indonesia") && !it.name.includes("Spanish"));
      }
    }

    // Remove Indonesian posts if lang is spanish
    if (this.lang === "es") return allChapters.filter((it) => !it.name.includes("Indonesia"));

    return allChapters;
  }

  // Pages

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document
      .select("div.entry-content")
      .select("a img, img.size-full")
      .map((img, i) => new Page(i, "", img.attr("data-orig-file")));
  }
}
