// Port of keiyoushi/extensions-source lib-multisrc/foolslide/FoolSlide.kt
import {
  CheckBoxPreference,
  DateTimeFormatter,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ago,
  parseAs,
  substringAfter,
  substringBefore,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
  type FilterList,
  type PreferenceScreen,
} from "../../sdk/index.ts";

const ORDINAL_SUFFIXES = ["st", "nd", "rd", "th"];
const DATE_FORMAT_1 = DateTimeFormatter.ofPattern("yyyy.MM.dd", Locale.US);
const DATE_FORMATS_WITH_ORDINAL_SUFFIXES = ORDINAL_SUFFIXES.map((it) => DateTimeFormatter.ofPattern(`dd'${it}' MMMM, yyyy`, Locale.US));
// Upstream: parseDefaulting(ChronoField.YEAR, current year). The SDK formatter has no defaulting, so the current
// year is appended to the input instead (see parseChapterDate).
const DATE_FORMATS_WITH_ORDINAL_SUFFIXES_NO_YEAR = ORDINAL_SUFFIXES.map((it) => DateTimeFormatter.ofPattern(`dd'${it}' MMMM yyyy`, Locale.US));

/** ZonedDateTime.now().plusDays(days).truncatedTo(ChronoUnit.DAYS), in the system zone. */
function localMidnight(days: number): number {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export abstract class FoolSlide extends KeiSource {
  protected urlModifier = "";

  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}${this.urlModifier}/directory/${page}/`)).asJsoup();
    const mangas = document.select(this.popularMangaSelector()).map((it) => this.popularMangaFromElement(it));
    const hasNextPage = document.select(this.popularMangaNextPageSelector()).first() != null;
    return new MangasPage(mangas, hasNextPage);
  }

  popularMangaSelector() {
    return "div.group";
  }

  popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const a = element.select("a[title]").first()!;
    manga.url = urlWithoutDomain(a.attr("href"));
    manga.title = a.text();
    const img = element.select("img").first();
    if (img) manga.thumbnail_url = img.absUrl("src").replace("/thumb_", "/");
    return manga;
  }

  popularMangaNextPageSelector() {
    return "div.next";
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}${this.urlModifier}/latest/${page}/`)).asJsoup();
    const mangas = document.select(this.latestUpdatesSelector()).map((it) => this.latestUpdatesFromElement(it));
    const selector = this.latestUpdatesNextPageSelector();
    const hasNextPage = selector != null ? document.select(selector).first() != null : false;
    return new MangasPage(mangas, hasNextPage);
  }

  latestUpdatesSelector() {
    return "div.group";
  }

  latestUpdatesFromElement(element: Element): SManga {
    const manga = SManga.create();
    const a = element.select("a[title]").first()!;
    manga.url = urlWithoutDomain(a.attr("href"));
    manga.title = a.text();
    return manga;
  }

  latestUpdatesNextPageSelector(): string | null {
    return "div.next";
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const form = new URLSearchParams({ search: query });
    const document = (await this.client.post(`${this.baseUrl}${this.urlModifier}/search/`, this.headers, form)).asJsoup();
    const mangas = document.select(this.searchMangaSelector()).map((it) => this.searchMangaFromElement(it));
    const hasNextPage = document.select(this.searchMangaNextPageSelector()).first() != null;
    return new MangasPage(mangas, hasNextPage);
  }

  searchMangaSelector() {
    return "div.group";
  }

  searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const a = element.select("a[title]").first()!;
    manga.url = urlWithoutDomain(a.attr("href"));
    manga.title = a.text();
    return manga;
  }

  searchMangaNextPageSelector() {
    return "a:has(span.next)";
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.baseUrl + manga.url, this.adultHeaders)).asJsoup();

    const sManga = await this.mangaDetailsParse(document);
    sManga.url = manga.url;
    const sChapters = document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it));

    return new SMangaUpdate(sManga, sChapters);
  }

  protected mangaDetailsInfoSelector = "div.info";

  // if there's no image on the details page, get the first page of the first chapter
  protected async getDetailsThumbnail(document: Document, urlSelector: string = this.chapterUrlSelector): Promise<string | undefined> {
    const img = document.select("div.thumbnail img, table.thumb img").first();
    if (img) return img.attr("abs:src");
    const url = document.select(this.chapterListSelector()).last()?.select(urlSelector).attr("abs:href");
    if (url == null) return undefined;
    const doc = (await this.client.get(url, this.adultHeaders)).asJsoup();
    return this.pageListParse(doc)[0]?.imageUrl;
  }

  async mangaDetailsParse(document: Document): Promise<SManga> {
    const manga = SManga.create();
    const infoElement = document.selectFirst(this.mangaDetailsInfoSelector);
    if (infoElement) {
      for (const b of infoElement.select("b")) {
        const text = b.text().toLowerCase();
        // Jsoup's b.nextSibling() is TextNode: the raw DOM sibling, not the next element
        const next = (b.node as { next?: { type: string; data?: string } | null }).next;
        const value = next?.type === "text" ? (next.data ?? "").replace(/\s+/g, " ").trim().replace(/^:/, "").trim() : "";

        if (value.length === 0) continue;

        if (text.includes("author") || text.includes("autore")) manga.author = value;
        else if (text.includes("artist")) manga.artist = value;
        else if (text.includes("synopsis") || text.includes("description") || text.includes("trama")) manga.description = value;
      }
    }
    manga.thumbnail_url = await this.getDetailsThumbnail(document);
    return manga;
  }

  protected get allowAdult(): boolean {
    return this.preferences.getBoolean("adult", true);
  }

  protected get adultHeaders(): Headers {
    const h = this.headersBuilder();
    h.append("Adult", "true");
    return h;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addInterceptor((request) => {
      if (request.headers.get("Adult") === "true") {
        const headers = new Headers(request.headers);
        headers.delete("Adult");
        if (this.allowAdult) {
          headers.set("Content-Type", "application/x-www-form-urlencoded");
          return { ...request, method: "POST", headers, body: "adult=true" };
        }
        return { ...request, headers };
      }
      return request;
    });
  }

  chapterListSelector() {
    return "div.group div.element, div.list div.element";
  }

  protected chapterDateSelector = "div.meta_r";

  protected chapterUrlSelector = "a[title]";

  chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const urlElement = element.select(this.chapterUrlSelector).first()!;
    const dateElement = element.select(this.chapterDateSelector).first()!;
    chapter.url = urlWithoutDomain(urlElement.attr("href"));
    chapter.name = urlElement.text();
    chapter.date_upload = this.parseChapterDate(substringAfter(dateElement.text(), ", ")) ?? 0;
    return chapter;
  }

  protected parseChapterDate(date: string): number | null {
    const lcDate = date.toLowerCase();
    if (lcDate.endsWith(" ago")) {
      const parsed = this.parseRelativeDate(lcDate);
      if (parsed != null) return parsed;
    }

    // Handle 'yesterday' and 'today', using midnight
    if (lcDate.startsWith("yesterday")) return localMidnight(-1);
    if (lcDate.startsWith("today")) return localMidnight(0);
    if (lcDate.startsWith("tomorrow")) return localMidnight(1);

    let result = DATE_FORMAT_1.tryParseDate(date) || null;

    for (const dateFormat of DATE_FORMATS_WITH_ORDINAL_SUFFIXES) {
      if (result == null) result = dateFormat.tryParseDate(date) || null;
      else break;
    }

    const year = new Date().getFullYear();
    for (const dateFormat of DATE_FORMATS_WITH_ORDINAL_SUFFIXES_NO_YEAR) {
      if (result == null) result = dateFormat.tryParseDate(`${date} ${year}`) || null;
      else break;
    }

    return result ?? 0;
  }

  /**
   * Parses dates in this form:
   * `11 days ago`
   */
  private parseRelativeDate(date: string): number | null {
    const trimmedDate = date.split(" ");

    if (trimmedDate.length < 3 || trimmedDate[2] !== "ago") return null;

    if (!/^[+-]?\d+$/.test(trimmedDate[0])) return null;
    const number = Number(trimmedDate[0]);
    const unit = trimmedDate[1].replace(/s$/, ""); // Remove 's' suffix

    switch (unit) {
      case "year":
      case "yr":
        return ago(number, "years");
      case "month":
        return ago(number, "months");
      case "week":
      case "wk":
        return ago(number, "weeks");
      case "day":
        return ago(number, "days");
      case "hour":
      case "hr":
        return ago(number, "hours");
      case "minute":
      case "min":
        return ago(number, "minutes");
      case "second":
      case "sec":
        return ago(number, "seconds");
      default:
        return null;
    }
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url, this.adultHeaders)).asJsoup();
    return this.pageListParse(document);
  }

  pageListParse(document: Document): Page[] {
    const doc = document.html();
    const jsonStr = substringBefore(substringAfter(doc, "var pages = "), ";");
    const pages = parseAs<{ url: string }[]>(jsonStr);
    return pages.map((jsonEl, i) => {
      // Resolve the relative URL against the page, as upstream's dummy element does
      let absUrl = "";
      try {
        absUrl = new URL(String(jsonEl.url), document.location()).href;
      } catch {
        // Jsoup's absUrl returns "" too
      }
      return new Page(i, "", absUrl);
    });
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new CheckBoxPreference(screen.context);
    p.key = "adult";
    p.summary = "Show adult content";
    p.setDefaultValue(true);
    screen.addPreference(p);
  }
}
