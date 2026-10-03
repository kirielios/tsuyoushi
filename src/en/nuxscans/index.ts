// Port of keiyoushi/extensions-source src/en/nuxscans/NuxScans.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, urlWithoutDomain, type ClientBuilder, type FilterList } from "../../../sdk/index.ts";

const JS_REDIRECT_REGEX = /window\.location\.replace\(['"]([^'"]+)['"]\)/;

export default class NuxScans extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    // Blogger redirects mobile User-Agents to ?m=1, which returns 404 for chapter posts.
    // ponytail: upstream is a NETWORK interceptor that also rewrites ?m=1 redirect targets; the host follows redirects
    // itself, so only the outgoing request is rewritten here.
    builder.addInterceptor((original) => {
      const url = toHttpUrl(original.url);
      if (url.queryParameter("m") !== "1") return original;
      return { ...original, url: url.newBuilder().setQueryParameter("m", "0").build().toString() };
    });
    builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      const response = await chain.proceed(request);

      if (response.isSuccessful && response.header("Content-Type")?.includes("text/html") === true) {
        const bodyString = response.text().slice(0, 1024 * 1024);
        const match = JS_REDIRECT_REGEX.exec(bodyString);
        if (match != null) {
          let newUrl = match[1];
          if (!newUrl.startsWith("http")) {
            newUrl = this.baseUrl + (newUrl.startsWith("/") ? newUrl : `/${newUrl}`);
          }
          return chain.proceed({ ...request, url: newUrl });
        }
      }
      return response;
    });
    return builder;
  }

  // ============================== Popular ===============================

  async getPopularManga(_page: number): Promise<MangasPage> {
    return this.parseMangaList(this.baseUrl);
  }

  private async parseMangaList(url: string): Promise<MangasPage> {
    const document = (await this.client.get(url)).asJsoup();

    const mangas = document.select(".index-post").map((element) => {
      const manga = SManga.create();
      const a = element.selectFirst(".post-title a")!;
      manga.title = a.text();
      manga.url = urlWithoutDomain(a.absUrl("href"));

      const img = element.selectFirst(".post-thumb");
      if (img) manga.thumbnail_url = img.absUrl("data-src") || img.absUrl("src");
      return manga;
    });

    return new MangasPage(mangas, false);
  }

  // =============================== Latest ===============================

  override get supportsLatest() {
    return false;
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // =============================== Search ===============================

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    return this.parseMangaList(`${this.baseUrl}/search?q=${query}`);
  }

  // =========================== Manga Details ============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    manga.title = document.selectFirst("h1.post-title")?.text() ?? manga.title;
    manga.description = document.selectFirst(".post-details h3:contains(Synopsis) + p")?.text();
    manga.thumbnail_url = document.selectFirst(".post-thumbnail img")?.absUrl("src");

    const authorText = document.selectFirst(".post-details p:contains(Author:)")?.text();
    manga.author = authorText?.includes("Author:") ? authorText.substring(authorText.indexOf("Author:") + "Author:".length) : authorText;

    const statusText = document.selectFirst(".post-details p:contains(Status:)")?.text();
    if (statusText == null) manga.status = SManga.UNKNOWN;
    else {
      const s = statusText.toLowerCase();
      manga.status = s.includes("ongoing") ? SManga.ONGOING : s.includes("completed") ? SManga.COMPLETED : s.includes("dropped") ? SManga.CANCELLED : SManga.UNKNOWN;
    }

    manga.genre = document
      .select(".post-tab-genre .post-genre a")
      .map((it) => it.text())
      .join(", ");

    const chapterList = document
      .select(".row-chapters .list-item a")
      .map((a) => {
        const chapter = SChapter.create();
        // Store the full absolute URL because chapters live on nuxscans.blogspot.com,
        // not on baseUrl (nuxscans-comics.blogspot.com).
        chapter.url = a.absUrl("href");
        const nameText = a.text();
        chapter.name = nameText.trim() !== "" && !Number.isNaN(Number(nameText)) ? `Chapter ${nameText}` : nameText;
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(manga, chapterList);
  }

  // =============================== Pages ================================

  // chapter.url is a full absolute URL (may be on nuxscans.blogspot.com, not baseUrl), so use it as-is.
  override getChapterUrl(chapter: SChapter): string {
    return chapter.url;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(chapter.url)).asJsoup();

    return document
      .select(".post-body img, .holder img")
      .filter((img) => {
        const src = img.absUrl("src").toLowerCase();
        return !(src.includes("logo") || src.includes("footer") || src.includes("credit") || img.hasClass("watermark"));
      })
      .map((img, i) => new Page(i, "", img.absUrl("src")));
  }
}
