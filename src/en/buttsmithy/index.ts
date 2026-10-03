// Port of keiyoushi/extensions-source src/en/buttsmithy/Buttsmithy.kt
import { DateTimeFormatter, Locale, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfter, urlWithoutDomain, type ClientBuilder, type Document, type Elements, type FilterList } from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";

export default class Buttsmithy extends KeiSource {
  // the full version of alfie for some reason has a separate url and isn't accessed like the other comics
  private readonly baseUrlAlfie = "https://buttsmithy.com";
  private readonly chapterOverviewBaseUrl = `${this.baseUrlAlfie}/archives/chapter`;

  private readonly inCase = "InCase";
  private readonly alfieTitle = "Alfie";
  private readonly alfieDateParser = DateTimeFormatter.ofPattern("H:mm MMMM d, yyyy", Locale.US);
  private readonly pageNrRegex = /^p*[0-9]+$/;

  override get supportsLatest(): boolean {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(TextInterceptor());
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage(await this.fetchAllComics(), false);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? this.fetchMangaDetails(manga) : Promise.resolve(manga);
    const chapterList = (async () => {
      if (!fetchChapters) return chapters;
      // TODO misc-chapter is currently broken
      if (manga.title.includes(this.alfieTitle)) return (await this.fetchAlfiePagesAsChapters(manga.url)).reverse();
      return (await this.fetchOtherPagesAsChapters(manga.title, this.baseUrl + manga.url)).reverse();
    })();

    return new SMangaUpdate(await details, await chapterList);
  }

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    if (manga.title.includes(this.alfieTitle)) {
      const pageDoc = (await this.client.get(this.baseUrlAlfie)).asJsoup();
      const mostRecentChapTitle = this.extractChapterTitleFromPageDoc(pageDoc);
      const chapTitle = substringAfter(manga.title, "Alfie - ").trim();

      const m = SManga.create();
      m.url = `${this.chapterOverviewBaseUrl}/${this.chapterTitleToChapterUrlName(chapTitle)}`;
      m.title = `${this.alfieTitle} - ${chapTitle}`;
      m.author = this.inCase;
      m.artist = this.inCase;
      m.status = this.decideAlfieStatusFromTitle(chapTitle, mostRecentChapTitle);
      m.genre = "fantasy, NSFW";
      m.thumbnail_url = this.generateImageUrlWithText(this.alfieTitle);
      return m;
    }
    return manga;
  }

  // Alfie manga and all chapters store absolute urls
  override getMangaUrl(manga: SManga): string {
    return manga.url.startsWith("http") ? manga.url : this.baseUrl + manga.url;
  }

  override getChapterUrl(chapter: SChapter): string {
    return chapter.url;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const comicPageDoc = (await this.client.get(chapter.url)).asJsoup();
    const imageUrl = comicPageDoc.select("#comic img").attr("src");

    return [new Page(0, "", imageUrl)];
  }

  /**
   * Fetches all the pages from a Comic and returns them as separate SChapters.
   * Because there is no overview for comics that aren't Alfie this needs to visit each page of
   * the chosen comic.
   */
  private async fetchOtherPagesAsChapters(comicTitle: string, startPageUrl: string): Promise<SChapter[]> {
    const allChapters: SChapter[] = [];
    let currentPageUrl = startPageUrl;
    let pageNr = 0;
    for (;;) {
      const currentDoc = (await this.client.get(currentPageUrl)).asJsoup();
      const currentPageComicPage = currentDoc.select("#comic img").first()!;
      const chapterTitle = currentPageComicPage.attr("alt");

      const chapter = SChapter.create();
      /* the setUrlWithoutDomain method can't be used here because Alfie has another base
       * namespace and when retrieving the pages it is impossible to clearly differentiate an
       * Alfie Chapter from some other comic chapter. */
      chapter.url = currentPageUrl;
      chapter.name = chapterTitle;
      chapter.chapter_number = pageNr;

      // get the preferences for the current comic (source_${id}_updateTime:${comicTitle}, one flat store here)
      const prefKey = `updateTime:${comicTitle.toLowerCase()}:${chapter.name}`;
      const currentTimeMillis = Date.now();
      // only update the time if the current chapter is not downloaded yet
      if (!this.preferences.contains(prefKey)) this.preferences.edit().putInt(prefKey, currentTimeMillis).apply();
      chapter.date_upload = this.preferences.getInt(prefKey, currentTimeMillis);

      allChapters.push(chapter);

      const potentialNextPageUrl = currentDoc.select(".comic-nav-next").attr("href");
      if (potentialNextPageUrl === "") return allChapters;
      currentPageUrl = potentialNextPageUrl;
      pageNr += 1;
    }
  }

  /** Fetches all the pages from one of Alfies chapters and returns them as separate SChapters. */
  private async fetchAlfiePagesAsChapters(startPageUrl: string, lastPageNr = 0): Promise<SChapter[]> {
    const allChapters: SChapter[] = [];
    let currentPageUrl = startPageUrl;
    for (;;) {
      const currentDoc = (await this.client.get(currentPageUrl)).asJsoup();
      const pagesAsChapters = currentDoc.select("article.has-post-thumbnail .post-content").map((postElement, index) => {
        const postTitleElement = postElement.select(".post-info .post-title a");
        const chapUrl = postTitleElement.attr("href");
        const title = postTitleElement.text();
        // this is needed for the MISC chapter where the pages are not numbered
        let pageNr: number;
        if (this.pageNrRegex.test(title)) {
          pageNr = Number(substringAfter(title, "p").trim());
          if (Number.isNaN(pageNr)) throw new Error(`NumberFormatException: ${title}`);
        } else pageNr = index + lastPageNr;

        const dateString = postElement.select(".post-info .post-date").text();
        const timeString = postElement.select(".post-info .post-time").text();
        const date = this.alfieDateParser.tryParseDateTime(`${timeString} ${dateString}`);

        const chapter = SChapter.create();
        /* Alfie has its own name space and thus can't be handled like other comics.
         * This means the setUrlWithoutDomain method can't be used */
        chapter.url = chapUrl;
        chapter.name = title;
        chapter.chapter_number = pageNr;
        chapter.date_upload = date;
        return chapter;
      });

      allChapters.push(...pagesAsChapters);

      const potentialNextPageUrl = currentDoc.select(".paginav-next a").attr("href");
      if (potentialNextPageUrl === "") return allChapters;
      currentPageUrl = potentialNextPageUrl;
    }
  }

  /**
   * Fetches all comics that are currently hosted on buttsmithy (including the first version of
   * alfie currently)
   */
  private async fetchAllComics(): Promise<SManga[]> {
    const mainDoc = (await this.client.get(this.baseUrl)).asJsoup();
    // Incases choose your own adventure comics
    const cyoaSelector = "#menu-item-331";
    // Incase other comics (ignoring alfie because alfie has its own subdomain)
    const otherComicsSelector = "#menu-item-38";

    const alfieChapters = await this.fetchAlfieSMangas();
    const cyoaComics = this.convertMenuElementToSManga(mainDoc.select(cyoaSelector));
    const otherComics = this.convertMenuElementToSManga(mainDoc.select(otherComicsSelector));

    // concat all different comic lists
    return [...alfieChapters, ...cyoaComics, ...otherComics];
  }

  /**
   * Fetches all chapters of Alfie (one of InCases comics) as separate SManga because this comic
   * is gigantic and only updates one page at a time.
   */
  private async fetchAlfieSMangas(): Promise<SManga[]> {
    const pageDoc = (await this.client.get(this.baseUrlAlfie)).asJsoup();
    const mostRecentChapTitle = this.extractChapterTitleFromPageDoc(pageDoc);

    return pageDoc
      .select("#chapter")
      .select("option.level-0")
      .map((chapterElement) => {
        const chapTitle = chapterElement.text().toLowerCase();
        const chapUrlName = this.chapterTitleToChapterUrlName(chapTitle);

        const m = SManga.create();
        m.url = `${this.chapterOverviewBaseUrl}/${chapUrlName}`;
        m.title = `${this.alfieTitle} - ${chapTitle}`;
        m.author = this.inCase;
        m.artist = this.inCase;
        m.status = this.decideAlfieStatusFromTitle(chapTitle, mostRecentChapTitle);
        m.genre = "fantasy, NSFW";
        m.thumbnail_url = this.generateImageUrlWithText(this.alfieTitle);
        return m;
      });
  }

  private decideAlfieStatusFromTitle(chapTitle: string, mostRecentChapTitle: string): number {
    return chapTitle === mostRecentChapTitle ? SManga.UNKNOWN : SManga.COMPLETED;
  }

  private extractChapterTitleFromPageDoc(doc: Document): string {
    return doc.select(".comic-chapter a").first()!.text().toLowerCase();
  }

  private chapterTitleToChapterUrlName(chapTitle: string): string {
    return chapTitle.toLowerCase() === "chapter 1" ? "chapter-1v2" : chapTitle.replaceAll(" ", "-").replaceAll(".", "-");
  }

  private convertMenuElementToSManga(menuElement: Elements): SManga[] {
    const comicLinkSelector = ".menu-item-type-custom a[href]";

    const linkElements = menuElement.select(comicLinkSelector);
    return (
      linkElements
        // filter out the first Alfie chapter that is still hosted under "incase.buttsmithy.com"
        // see "fetchAlfieSMangas()" for how Alfie should be retrieved
        .filter((linkElement) => !linkElement.text().includes(this.alfieTitle))
        .map((linkElement) => {
          const comicTitle = linkElement.text();
          const comicUrl = linkElement.attr("href");

          const m = SManga.create();
          m.url = urlWithoutDomain(comicUrl);
          m.title = comicTitle;
          m.author = this.inCase;
          m.artist = this.inCase;
          m.status = SManga.COMPLETED;
          m.genre = "NSFW";
          m.thumbnail_url = this.generateImageUrlWithText(comicTitle);
          return m;
        })
    );
  }

  private generateImageUrlWithText(text: string): string {
    return TextInterceptorHelper.createUrl(text, "");
  }
}
