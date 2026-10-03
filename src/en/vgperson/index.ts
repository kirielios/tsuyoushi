// Port of keiyoushi/extensions-source src/en/vgperson/Vgperson.kt
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfter, toHttpUrl, type Element, type FilterList } from "../../../sdk/index.ts";

// upstream: "Mozilla/5.0 (Android ${VERSION.RELEASE}; Mobile) Tachiyomi/${AppInfo.getVersionName()}"
const USER_AGENT = "Mozilla/5.0 (Android 14; Mobile) Tachiyomi/0.18.0";

export default class Vgperson extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private get homeUrl() {
    return `${this.baseUrl}/other/mangaviewer.php`;
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("User-Agent", USER_AGENT);
    return headers;
  }

  override getHomeUrl(): string {
    return this.homeUrl;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.homeUrl)).asJsoup();

    const mangas = document.select(".content a[href^=?m]").map((element) => {
      const manga = SManga.create();
      manga.title = element.text();
      manga.url = element.attr("href");
      manga.thumbnail_url = this.getCover(manga.title);
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.homeUrl + manga.url)).asJsoup();

    const details = SManga.create();
    details.title = document.selectFirst(".title")!.text();
    details.thumbnail_url = this.getCover(details.title);
    switch (document.select("div.content .complete").text()) {
      case "(Complete)":
        details.status = SManga.COMPLETED;
        break;
      case "(Series in Progress)":
        details.status = SManga.ONGOING;
        break;
      default:
        details.status = SManga.UNKNOWN;
    }
    let description = "";
    for (const it of document.selectFirst(".content")!.childNodes().slice(5)) {
      if (typeof it !== "string" && it.tagName() === "table") break;
      if (typeof it === "string") description += it;
      else if (it.tagName() === "br") description += "\n";
      else description += it.text();
    }
    details.description = description;

    const chapters = document
      .select(".chaptertable tbody tr")
      .map((element: Element) => {
        const chapter = SChapter.create();
        const a = element.selectFirst("td > a")!;
        chapter.name = a.text();
        chapter.url = a.attr("href");

        // append the name if it exists & remove the occasional hyphen
        const last = element.selectFirst("td:last-child:not(:first-child)");
        if (last) chapter.name += ` - ${substringAfter(last.text(), "- ")}`;

        const fullUrl = toHttpUrl(`${this.homeUrl}${chapter.url}`);

        // hardcode special chapter numbers for Three Days of Happiness
        const c = fullUrl.queryParameter("c");
        chapter.chapter_number = c != null ? Number.parseFloat(c) : 16.5 + Number.parseFloat(fullUrl.queryParameter("b")!) / 10;
        chapter.scanlator = "vgperson";
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(details, chapters);
  }

  override getMangaUrl(manga: SManga): string {
    return this.homeUrl + manga.url;
  }

  override getChapterUrl(chapter: SChapter): string {
    return this.homeUrl + chapter.url;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.homeUrl + chapter.url)).asJsoup();

    return document.select("img").map((img, i) => new Page(i, "", img.absUrl("src")));
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage(
      (await this.getPopularManga(1)).mangas.filter((it) => it.title.toLowerCase().includes(query.toLowerCase())),
      false,
    );
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const u = toHttpUrl(url.href);
    if (u.host !== toHttpUrl(this.baseUrl).host || u.pathSegments[1] !== "mangaviewer.php" || !url.searchParams.has("m")) {
      return null;
    }

    const slug = `?m=${url.searchParams.get("m")}`;
    const manga = SManga.create();
    manga.url = slug;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.url = slug;
    result.initialized = true;
    return result;
  }

  // get known manga covers from imgur
  private getCover(title: string): string | undefined {
    const id = { "The Festive Monster's Cheerful Failure": "kEK10GL.png", "Azure and Claude": "buXnlmh.jpg", "Three Days of Happiness": "kL5dvnp.jpg" }[title];
    return id != null ? `https://i.imgur.com/${id}` : undefined;
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }
}
