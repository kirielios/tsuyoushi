// Port of keiyoushi/extensions-source src/en/colorizedmangas/ColorizedMangas.kt
import {
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  isBlank,
  substringAfterLast,
  urlWithoutDomain,
  type Document,
  type FilterList,
} from "../../../sdk/index.ts";

const CHAPTER_NUMBER_REGEX = /\d+(\.\d+)?/;

export default class ColorizedMangas extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    return new MangasPage(this.parseMangaList(document), false);
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getPopularManga(page);
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    const allMangas = this.parseMangaList(document);

    let filtered = allMangas;
    if (!isBlank(query)) {
      const cleanQuery = query.trim().toLowerCase();
      filtered = allMangas.filter((it) => it.title.toLowerCase().includes(cleanQuery));
    }
    return new MangasPage(filtered, false);
  }

  protected override async getMangaByUrl(u: URL): Promise<SManga | null> {
    const url = HttpUrl.parse(u.toString());
    if (url.host !== HttpUrl.parse(this.baseUrl).host) return null;

    const slug = url.pathSegments.find((it) => it.length > 0);
    if (slug === undefined) return null;

    const document = (await this.client.get(`${this.baseUrl}/${slug}`)).asJsoup();
    const manga = SManga.create();
    manga.url = `/${slug}`;
    return this.parseMangaDetails(document, manga);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const updatedManga = this.parseMangaDetails(document, manga);
    const chapterList = this.parseChapterList(document);
    return new SMangaUpdate(updatedManga, chapterList);
  }

  private parseMangaDetails(document: Document, manga: SManga): SManga {
    const aside = document.selectFirst("aside")!;

    manga.title = aside.selectFirst("h1")!.text().replace(/^Colorized/, "").trim();
    manga.thumbnail_url = aside.selectFirst("img")?.absUrl("src");
    manga.author = aside.selectFirst("dl > div dt:contains(Author) + dd")?.textOrNull() ?? undefined;

    const genresBlock = aside.select("p.text-\\[11px\\]").first();
    if (genresBlock != null) {
      manga.genre = genresBlock
        .text()
        .split("·")
        .map((it) => it.trim())
        .filter((it) => it.length > 0)
        .join(", ");
    }

    manga.description = aside.selectFirst("p.border-t")?.textOrNull() ?? undefined;
    manga.status = SManga.UNKNOWN;
    return manga;
  }

  private parseChapterList(document: Document): SChapter[] {
    const chapterLinks = document.select("div.space-y-4 section div.space-y-2 > a");

    const chapters: SChapter[] = [];
    for (const element of chapterLinks) {
      const chNumText = element.selectFirst("span.font-bold")?.textOrNull() ?? null;
      const chTitleText = element.selectFirst("div.truncate")?.textOrNull() ?? null;

      if (chNumText === null && chTitleText === null) continue;

      let chapterName = "";
      if (chNumText !== null) {
        chapterName += chNumText;
        if (chTitleText !== null && chTitleText.toLowerCase() !== chNumText.toLowerCase()) chapterName += ` - ${chTitleText}`;
      } else if (chTitleText !== null) {
        chapterName += chTitleText;
      }

      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.absUrl("href"));
      chapter.name = chapterName;
      const chNumMatch = CHAPTER_NUMBER_REGEX.exec(chNumText ?? chTitleText ?? "");
      chapter.chapter_number = chNumMatch ? Number.parseFloat(chNumMatch[0]) : -1;
      chapters.push(chapter);
    }

    // compareByDescending chapter_number, thenByDescending name
    return chapters.sort((a, b) => b.chapter_number - a.chapter_number || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(`${this.baseUrl}${chapter.url}`)).asJsoup();
    return document.select("main img[src*=pages]").map((img, index) => new Page(index, "", img.absUrl("src")));
  }

  private parseMangaList(document: Document): SManga[] {
    const elements = document.select("div.lib-color-view a[href], div.lib-bw-view a[href]");
    const seenUrls = new Set<string>();

    const out: SManga[] = [];
    for (const element of elements) {
      const href = element.attr("href").replace(/\/$/, ""); // removeSuffix("/"): one slash only
      const slug = substringAfterLast(href, "/");
      if (isBlank(slug) || seenUrls.has(slug)) continue;
      seenUrls.add(slug);

      const titleText = element.selectFirst("h3")?.textOrNull();
      if (!titleText) continue;

      const manga = SManga.create();
      manga.url = `/${slug}`;
      manga.title = titleText;
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
      out.push(manga);
    }
    return out;
  }
}
