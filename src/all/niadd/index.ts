// Port of keiyoushi/extensions-source src/all/niadd/Niadd.kt
import { DateTimeFormatter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, escapeRegex, isBlank, toHttpUrl, urlWithoutDomain, type Document, type Element } from "../../../sdk/index.ts";

const ALL_IMGS_URL_REGEX = /all_imgs_url\s*:\s*\[([\s\S]*?)\]/;
const CLEAN_IMG_URL_REGEX = /["'\s]/g;
const PAGE_IMAGE_SELECTOR = "div.pic_box img.manga_pic, div.reading-content img";
const CHAPTER_NUMBER_REGEX = /Capítulo\s+(\d+(\.\d+)?)/;
const dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.ENGLISH);

/** String.contains(other, ignoreCase = true) */
const containsIgnoreCase = (s: string, other: string) => s.toLowerCase().includes(other.toLowerCase());
/** String.replace(old, new, ignoreCase = true) */
const replaceIgnoreCase = (s: string, old: string, by: string) => s.replace(new RegExp(escapeRegex(old), "gi"), () => by);

export default class Niadd extends KeiSource {
  // Popular
  async getPopularManga(_page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/list/Hot-Manga.html`)).asJsoup());
  }

  private popularMangaSelector() {
    return "div.manga-item";
  }

  private popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.title = element.selectFirst("div.manga-name")!.text();
    const rawUrl = element.selectFirst("a")!.absUrl("href");
    manga.url = urlWithoutDomain(rawUrl);
    const thumb = element.selectFirst("div.manga-img img")?.attr("abs:src");
    if (thumb != null) manga.thumbnail_url = thumb;
    return manga;
  }

  private parseMangaList(document: Document): MangasPage {
    const mangas = document.select(this.popularMangaSelector()).map((it) => this.popularMangaFromElement(it));
    return new MangasPage(mangas, false);
  }

  // Search
  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/search/`).newBuilder().addQueryParameter("name", query).build();
    return this.parseMangaList((await this.client.get(url.toString())).asJsoup());
  }

  // Latest
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/list/New-Update.html`)).asJsoup());
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchDetails(manga) : manga, fetchChapters ? this.fetchChapterList(manga) : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  // Details
  private async fetchDetails(mangaIn: SManga): Promise<SManga> {
    const manga = SManga.create();
    const document = (await this.client.get(this.getMangaUrl(mangaIn))).asJsoup();
    const infoElement = document.select("div.bookside-general, div.detail-general");

    manga.url = mangaIn.url;
    manga.title = document.selectFirst("h1, .book-headline-name")!.text();
    manga.author = replaceIgnoreCase(infoElement.select(".detail-general-cell:contains(Autor) span, [itemprop=author] span").text(), "Autor (es):", "");
    manga.artist = replaceIgnoreCase(infoElement.select(".detail-general-cell:contains(Artista) span").text(), "Artista:", "");
    manga.genre = document.select("[itemprop=genre]").eachText().join(", ");

    const yearKeywords = ["Released:", "Lanzado:", "Rilasciato:", "Выпущенный:", "Liberado:", "Freigegeben:"];

    const yearRaw =
      infoElement
        .select(".detail-general-cell")
        .find((cell) => yearKeywords.some((it) => containsIgnoreCase(cell.text(), it)))
        ?.selectFirst("span")
        ?.text() ?? "";

    const yearClean = yearKeywords.reduce((acc, keyword) => replaceIgnoreCase(acc, keyword, ""), yearRaw);

    const synopsisKeywords = ["Synopsis", "Sinopsis", "Sinossi", "конспект", "Sinopse", "Zusammenfassung"];

    const synopsisText = (() => {
      const titles = document.select(".detail-cate-title");
      for (const title of titles) {
        const titleText = title.text();
        if (synopsisKeywords.some((keyword) => containsIgnoreCase(titleText, keyword))) {
          const nextSection = title.nextElementSibling();
          if (nextSection != null && nextSection.hasClass("detail-section")) {
            if (nextSection.select("a[itemprop=genre]").length === 0) return nextSection.text();
          }
        }
      }
      return "";
    })();

    let description = "";
    if (yearClean.length > 0) description += `Ano: ${yearClean}\n\n`;
    if (synopsisText.length > 0) description += synopsisText;
    manga.description = description;

    manga.thumbnail_url = document.selectFirst("div.detail-img img, div.bookside-img img")?.attr("abs:src");
    manga.status = SManga.ONGOING;
    return manga;
  }

  // Chapters
  private readonly chapterListSelector = "ul.chapter-list a.hover-underline";

  private parseDate(dateString: string): number {
    if (containsIgnoreCase(dateString, "atrás") || containsIgnoreCase(dateString, "ago")) return 0;

    return dateFormat.tryParseDate(dateString);
  }

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const chaptersUrl = `${this.baseUrl}${manga.url.replace(/\.html$/, "")}/chapters.html`;
    const document = (await this.client.get(chaptersUrl)).asJsoup();
    if (document.selectFirst("ul.chapter-list") == null) throw new Error("ul.chapter-list not found");

    return document.select(this.chapterListSelector).map((it) => this.chapterFromElement(it));
  }

  private chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const rawUrl = element.attr("abs:href");
    chapter.url = urlWithoutDomain(rawUrl);

    const title = element.selectFirst("span.chp-title, span.chapter-name, span.name")?.text();
    chapter.name = title ? title : element.text();

    const time = element.selectFirst("span.chp-time, span.chapter-time, span.time")?.text();
    if (time != null) chapter.date_upload = this.parseDate(time);

    const n = CHAPTER_NUMBER_REGEX.exec(chapter.name)?.[1];
    const f = n == null ? Number.NaN : Number.parseFloat(n);
    chapter.chapter_number = Number.isNaN(f) ? -1 : f;
    return chapter;
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse((await this.client.get(this.getChapterUrl(chapter))).asJsoup());
  }

  private async pageListParse(document: Document): Promise<Page[]> {
    const pages: Page[] = [];
    const currentUrl = document.location();
    const html = document.html();

    if (html.includes("all_imgs_url")) {
      const match = ALL_IMGS_URL_REGEX.exec(html);
      if (match != null) {
        const content = match[1];
        const urls = content
          .split(",")
          .map((it) => it.replace(CLEAN_IMG_URL_REGEX, ""))
          .filter((it) => it.startsWith("http"));

        urls.forEach((url, i) => pages.push(new Page(i, currentUrl, url)));
        if (pages.length > 0) return pages;
      }
    }

    const sourceButton = document.selectFirst("a.cool-blue.vision-button");
    if (sourceButton != null) {
      const sourceUrl = sourceButton.attr("abs:href");
      const requestHeaders = new Headers(this.headers);
      requestHeaders.set("Referer", currentUrl);

      return this.pageListParse((await this.client.get(sourceUrl, requestHeaders)).asJsoup());
    }

    // One image per sub page; resolve them lazily instead of fetching every sub page up front
    const subPages = document
      .select("select.sl-page option")
      .map((it) => it.absUrl("value"))
      .filter((it) => it.length > 0);
    if (subPages.length > 0) return subPages.map((url, i) => new Page(i, url));

    for (const img of document.select(PAGE_IMAGE_SELECTOR)) {
      const url = img.attr("abs:src");
      if (url.length > 0 && !url.includes("cover") && !url.includes("logo")) pages.push(new Page(pages.length, currentUrl, url));
    }

    return pages;
  }

  override async getImageUrl(page: Page): Promise<string> {
    return (await this.client.get(page.url)).asJsoup().selectFirst(PAGE_IMAGE_SELECTOR)!.attr("abs:src");
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const request = super.imageRequest(page);
    const headers = new Headers(request.headers);
    headers.set("Referer", page.url);
    return { url: request.url, headers };
  }
}
