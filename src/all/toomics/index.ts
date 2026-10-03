// Port of keiyoushi/extensions-source src/all/toomics/ToomicsGlobal.kt (+ Dto.kt)
import {
  DateTimeFormatter,
  DateTimeFormatterBuilder,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  parseHtml,
  substringAfter,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
} from "../../../sdk/index.ts";

// --- Dto.kt
interface SearchDto {
  webtoon: { sHtml: string };
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const UNICODE_REGEX = /\\u([0-9A-Fa-f]{4})|\\U([0-9A-Fa-f]{8})/g;
const ESCAPE_CHAR_REGEX = /(\\n)|(\\r)|(\\{1})/g;

const dateFormatter = (pattern: string, locale: Locale): DateTimeFormatter => new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern(pattern).toFormatter(locale);

export default class ToomicsGlobal extends KeiSource {
  private get siteLang(): string {
    switch (this.lang) {
      case "zh-Hans":
        return "sc";
      case "zh-Hant":
        return "tc";
      case "es-419":
        return "mx";
      case "pt-BR":
        return "por";
      default:
        return this.lang;
    }
  }

  private get dateFormat(): DateTimeFormatter {
    switch (this.lang) {
      case "zh-Hans":
        return dateFormatter("yyyy.M.d", Locale.forLanguageTag("zh-CN")); // SIMPLIFIED_CHINESE
      case "zh-Hant":
        return dateFormatter("yyyy.M.d", Locale.forLanguageTag("zh-TW")); // TRADITIONAL_CHINESE
      case "es-419":
        return dateFormatter("d MMM, yyyy", Locale.forLanguageTag("es-419"));
      case "es":
        return dateFormatter("d MMM, yyyy", Locale.forLanguageTag("es-419"));
      case "it":
        return dateFormatter("d MMM, yyyy", Locale.forLanguageTag("it")); // ITALIAN
      case "de":
        return dateFormatter("d. MMM yyyy", Locale.GERMAN);
      case "fr":
        return dateFormatter("d MMM. yyyy", Locale.ENGLISH);
      case "pt-BR":
        return dateFormatter("d 'de' MMM 'de' yyyy", Locale.forLanguageTag("pt-BR"));
      default:
        return dateFormatter("MMM d, yyyy", Locale.ENGLISH);
    }
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.connectTimeout(60_000).readTimeout(60_000);
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("Referer", `${this.baseUrl}/${this.siteLang}`);
    // Required: Prevents Toomics from returning the mobile layout, which breaks all CSS selectors.
    headers.set("User-Agent", USER_AGENT);
    return headers;
  }

  // ================================== Popular =======================================

  async getPopularManga(_page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/${this.siteLang}/webtoon/ranking`)).asJsoup());
  }

  // ================================== Latest =======================================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/${this.siteLang}/webtoon/new_comics`)).asJsoup());
  }

  private parseMangaList(document: ReturnType<typeof parseHtml>): MangasPage {
    const mangas: SManga[] = [];
    for (const element of document.select("li > div.visual a:has(img)")) {
      const title = element.selectFirst("h4[class$=title]")?.ownText();
      if (title == null) continue;

      const manga = SManga.create();
      manga.title = title;
      const img = element.selectFirst("img");
      manga.thumbnail_url = img ? (img.hasAttr("data-original") ? img.attr("data-original") : img.attr("src")) : undefined;
      // The path segment '/search/Y' bypasses the age check and prevents redirection to the chapter
      manga.url = urlWithoutDomain(`${element.absUrl("href")}/search/Y`);
      mangas.push(manga);
    }
    return new MangasPage(mangas, false);
  }

  // ================================== Search =======================================

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const formBody = new URLSearchParams({ toonData: query });
    const searchDto = (await this.client.post(`${this.baseUrl}/${this.siteLang}/webtoon/ajax_search`, undefined, formBody)).parseAs<SearchDto>();
    const document = parseHtml(this.host.load, this.clearHtml(searchDto.webtoon.sHtml), this.baseUrl);
    const mangas: SManga[] = [];
    for (const element of document.select("#search-list-items li")) {
      const title = element.selectFirst("strong")?.text();
      if (title == null) continue;
      const anchor = element.selectFirst("a.relative");
      if (!anchor) continue;

      const manga = SManga.create();
      manga.title = title;
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");

      const href = substringBefore(substringAfter(anchor.attr("href"), "Base.setFamilyMode('N', '"), "'");
      const url = href.toLowerCase().includes(this.baseUrl.toLowerCase()) ? toHttpUrl(href) : toHttpUrl(`${this.baseUrl}${decodeURIComponent(href.replaceAll("+", " "))}`);
      // The path segment '/search/Y' bypasses the age check and prevents redirection to the chapter
      manga.url = urlWithoutDomain(`${this.baseUrl}/${this.siteLang}/webtoon/episode/toon/${url.queryParameter("toon")}/search/Y`);
      mangas.push(manga);
    }
    return new MangasPage(mangas, false);
  }

  // ================================== Manga Details ================================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const header = document.selectFirst("#glo_contents section.relative:has(img[src*=thumb])");
    if (!header) throw new Error("Could not find manga details header");

    const title = header.selectFirst("h2")?.text();
    if (title == null) throw new Error("Could not find manga title");
    manga.title = title;

    const creators = header.select("a[href*='searchtype=author']").map((it) => it.text());
    if (creators.length > 0) {
      manga.artist = creators[0];
      manga.author = creators[creators.length - 1];
    }

    const genres = header.selectFirst("h2 + div li:nth-child(2)")?.text().split("·") ?? [];
    const tags = header.select("a[data-tag-name]").map((it) => it.attr("data-tag-name"));
    manga.genre = [...new Set([...genres, ...tags].map((it) => it.trim()).filter((it) => it.length > 0))].join(", ");
    manga.description = header.selectFirst(".break-noraml.text-xs")?.text();
    manga.thumbnail_url = document.selectFirst("head meta[property='og:image']")?.attr("content");

    // coin-type1 - free chapter, coin-type6 - already read chapter
    const dateFormat = this.dateFormat;
    const chapterList: SChapter[] = [];
    for (const element of document.select("li.normal_ep:has(.coin-type1, .coin-type6)")) {
      const num = element.selectFirst("div.cell-num")?.text() ?? "";
      const numText = num.length > 0 ? `${num} - ` : "";
      const chTitle = element.selectFirst("div.cell-title strong")?.ownText() ?? "";
      const a = element.selectFirst("a");
      if (!a) continue;
      const link = a.attr("onclick");

      const chapter = SChapter.create();
      chapter.name = `${numText}${chTitle}`;
      const n = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(num) ? Number.parseFloat(num) : -1;
      chapter.chapter_number = n;
      chapter.date_upload = dateFormat.tryParseDate(element.selectFirst("div.cell-time time")?.text());
      chapter.scanlator = "Toomics";
      chapter.url = substringBefore(substringAfter(link, "href='"), "'");
      chapterList.push(chapter);
    }
    chapterList.reverse();

    return new SMangaUpdate(manga, chapterList);
  }

  // ================================== Pages ========================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    let document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    if (document.selectFirst("div.section_age_verif") != null) {
      // Same request the site's "Yes, I'm over 18" button makes; stores adult display mode in the session
      await this.client.get(`${this.baseUrl}/${this.siteLang}/index/set_display/?display=A&return=%2F${this.siteLang}`);
      document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
      if (document.selectFirst("div.section_age_verif") != null) throw new Error("Verify age via WebView");
    }

    const url = document.selectFirst("head meta[property='og:url']")?.attr("content") ?? "";

    return document.select("div[id^=load_image_] img").map((el, i) => new Page(i, url, el.attr("data-src")));
  }

  override imageRequest(page: Page): { url: string; headers: Headers } {
    const request = super.imageRequest(page);
    const headers = new Headers(request.headers);
    headers.set("Referer", page.url);
    return { url: request.url, headers };
  }

  // ================================== Utilities ====================================

  private clearHtml(s: string): string {
    return this.unicode(s).replace(ESCAPE_CHAR_REGEX, "");
  }

  private unicode(s: string): string {
    return s.replace(UNICODE_REGEX, (_m, g1: string | undefined, g2: string | undefined) => {
      const hex = g1 ? g1 : (g2 ?? "");
      // Int.toChar() keeps the low 16 bits
      return String.fromCharCode(Number.parseInt(hex, 16) & 0xffff);
    });
  }
}
