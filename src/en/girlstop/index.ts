// Port of keiyoushi/extensions-source src/en/girlstop/GirlsTop.kt (+ Filters.kt)
import { DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, isBlank, urlWithoutDomain, type Document, type Response } from "../../../sdk/index.ts";

// --- Filters.kt
class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

class Filters extends UriPartFilter {
  constructor() {
    super("Sort By", [
      ["─── POPULAR ───", "filter.php?srt=viw"],
      ["Popular: Week", "filter.php?srt=viw"],
      ["Popular: 2 Weeks", "filter.php?srt=viw&week2"],
      ["Popular: Month", "filter.php?srt=viw&month"],
      ["Popular: 3 Months", "filter.php?srt=viw&month3"],
      ["Popular: Half Year", "filter.php?srt=viw&month6"],

      ["─── BEST ───", "filter.php?srt=pop"],
      ["Best: Relevance", "filter.php?srt=pop"],
      ["Best: 2 Weeks", "filter.php?srt=pop&week2"],
      ["Best: Month", "filter.php?srt=pop&month"],
      ["Best: 3 Months", "filter.php?srt=pop&month3"],
      ["Best: Half Year", "filter.php?srt=pop&month6"],

      ["─── SANDBOX ───", "index.php?new=d"],
      ["Sandbox: New", "index.php?new=d"],
      ["Sandbox: Random All", "filter.php?srt=promo"],
      ["Sandbox: Random By New Authors", "filter.php?srt=promonew"],
      ["Sandbox: Best", "filter.php?srt=dpop"],

      ["─── POPULAR MODELS ───", "models.php?popular"],
      ["Models: Day", "models.php?popular"],
      ["Models: Week", "models.php?popular&week"],
      ["Models: Month", "models.php?popular&month"],
      ["Models: Favorites", "models.php?popular&favorite"],
      ["Models: Sets", "models.php?popular&sets"],
    ]);
  }
}

const TITLE_SUFFIX_REGEX = / - nude galleries.*/;

export default class GirlsTop extends KeiSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

  // Enforce a desktop User-Agent to prevent redirects to the mobile site (me.girlstop.info)
  protected override configureHeaders(headers: Headers): Headers {
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36");
    return headers;
  }

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = page === 1 ? `${this.baseUrl}/filter.php?srt=viw` : `${this.baseUrl}/filter.php?srt=viw&page=${page - 1}`;
    return this.extractMangasFromDocument((await this.client.get(url)).asJsoup());
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = page === 1 ? `${this.baseUrl}/index.php` : `${this.baseUrl}/index.php?page=${page - 1}`;
    return this.extractMangasFromDocument((await this.client.get(url)).asJsoup());
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (!isBlank(query)) {
      const formBody = new URLSearchParams({ text: query });
      return this.extractMangasFromDocument((await this.client.post(`${this.baseUrl}/models.php`, undefined, formBody)).asJsoup());
    }

    const sortPath = firstInstanceOrNull(filters, Filters)?.toUriPart() ?? "filter.php?srt=viw";
    const url = page === 1 ? `${this.baseUrl}/${sortPath}` : `${this.baseUrl}/${sortPath}&page=${page - 1}`;
    return this.extractMangasFromDocument((await this.client.get(url)).asJsoup());
  }

  // ============================== Details ==============================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (manga.url.includes("psto.php")) {
      const details = fetchDetails ? this.mangaDetailsParseResponse(await this.client.get(this.getMangaUrl(manga))) : manga;
      const gallery = SChapter.create();
      gallery.url = manga.url;
      gallery.name = "Gallery";
      gallery.chapter_number = 1;
      return new SMangaUpdate(details, [gallery]);
    }

    const response = await this.client.get(this.getMangaUrl(manga));
    const isModel = response.url.includes("models.php");
    const document = response.asJsoup();
    const details = this.mangaDetailsParse(document, isModel);
    const chapterList = fetchChapters ? await this.fetchChapterList(document) : chapters;

    return new SMangaUpdate(details, chapterList);
  }

  private mangaDetailsParseResponse(response: Response): SManga {
    const isModel = response.url.includes("models.php");
    return this.mangaDetailsParse(response.asJsoup(), isModel);
  }

  private mangaDetailsParse(document: Document, isModel: boolean): SManga {
    const manga = SManga.create();
    if (isModel) {
      manga.title = document.selectFirst("h1.index")!.text().replace(TITLE_SUFFIX_REGEX, "").trim();
      manga.description = document.selectFirst("#modeldesc")?.text();
      manga.thumbnail_url = document.selectFirst(".model-cover img")?.absUrl("src");
      manga.status = SManga.ONGOING;
    } else {
      manga.title = document.selectFirst("h1")!.text();
      manga.author = document.selectFirst(".ps-desc a[href*='user.php']")?.text();
      manga.genre = document
        .select(".ps-tags a")
        .map((it) => it.text())
        .join(", ");
      let description = "";
      for (const it of document.select(".ps-desc").filter((e) => !e.is(".ps-tags"))) description += `${it.text()}\n`;
      manga.description = description.trim();
      manga.thumbnail_url = document.selectFirst(".tiles-wrap img")?.absUrl("src");
      manga.status = SManga.COMPLETED;
    }
    return manga;
  }

  // ============================= Chapters ==============================

  private async fetchChapterList(firstPage: Document): Promise<SChapter[]> {
    const chapters: SChapter[] = [];
    let document = firstPage;

    for (;;) {
      for (const element of document.select(".thumbs .thumb")) {
        const chapter = SChapter.create();
        const a = element.selectFirst(".post_title a")!;
        chapter.url = urlWithoutDomain(a.absUrl("href"));
        chapter.name = a.text();

        const dateRow = element.select("tr").find((it) => it.selectFirst("td")?.text().includes("Approved") === true);
        const dateStr = dateRow?.select("td").last()?.text();
        chapter.date_upload = this.parseDate(dateStr);
        chapters.push(chapter);
      }

      const nextUrl = document.selectFirst("li.next a")?.attr("href");
      if (nextUrl == null) break;
      document = (await this.client.get(`${this.baseUrl}/${nextUrl}`)).asJsoup();
    }

    return chapters;
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("a.fullimg").map((a, index) => new Page(index, "", a.absUrl("href")));
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Search query ignores filters"), new Filter.Separator(), new Filters());
  }

  // ============================= Utilities =============================

  private extractMangasFromDocument(document: Document): MangasPage {
    const mangas = document.select(".thumbs .thumb").map((element) => {
      const manga = SManga.create();
      const a = element.selectFirst(".post_title a")!;
      manga.title = a.text();
      manga.url = urlWithoutDomain(a.absUrl("href"));
      manga.thumbnail_url = element.selectFirst("picture img")?.absUrl("src");
      return manga;
    });
    const hasNextPage = document.selectFirst("li.next a") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private parseDate(dateStr: string | null | undefined): number {
    if (isBlank(dateStr)) return 0;
    const lower = dateStr.toLowerCase();
    if (lower.includes("today") || lower.includes("just now") || lower.includes("recently")) return Date.now();
    if (lower.includes("yesterday")) return Date.now() - 86400000;
    return this.dateFormat.tryParseDate(dateStr);
  }
}
