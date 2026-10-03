// Port of keiyoushi/extensions-source src/all/comicfury/ComicFury.kt (+ Filters.kt, ContentWarningInterceptor.kt)
import {
  DateTimeFormatter,
  Filter,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  PreferenceScreen,
  Response,
  SChapter,
  SManga,
  SwitchPreferenceCompat,
  POST,
  substringAfter,
  toHttpUrl,
  urlWithoutDomain,
  type ChainInterceptor,
  type ClientBuilder,
  type Document,
  type Element,
  type FilterList,
  type Request,
} from "../../../sdk/index.ts";
import { TextInterceptor, TextInterceptorHelper } from "../../../libs/textinterceptor/index.ts";

// ========================= Filters.kt =========================
class SortFilter extends Filter.Select<string> {
  constructor(index: number) {
    super("Sort By", ["Relevance", "Popularity", "Last Update"], index);
  }
}

class CompletedComicFilter extends Filter.CheckBox {
  constructor() {
    super("Comic Completed", false);
  }
}

class LastUpdatedFilter extends Filter.Select<string> {
  constructor() {
    super("Last Updated", ["All Time", "This Week", "This Month", "This Year", "Completed Only"], 0);
  }
}

class ViolenceFilter extends Filter.Select<string> {
  constructor() {
    super("Violence", ["None / Minimal", "Violent Content", "Gore / Graphic"], 2);
  }
}

class NudityFilter extends Filter.Select<string> {
  constructor() {
    super("Frontal Nudity", ["None", "Occasional", "Frequent"], 2);
  }
}

class StrongLangFilter extends Filter.Select<string> {
  constructor() {
    super("Strong Language", ["None", "Occasional", "Frequent"], 2);
  }
}

class SexualFilter extends Filter.Select<string> {
  constructor() {
    super("Sexual Content", ["No Sexual Content", "Sexual Situations", "Strong Sexual Themes"], 2);
  }
}

class TagsFilter extends Filter.Text {
  constructor() {
    super("Tags");
  }
}

// ========================= ContentWarningInterceptor.kt =========================
function ContentWarningInterceptor(): ChainInterceptor {
  return async (chain) => {
    const request = chain.request();
    const response = await chain.proceed(request);

    if (response.isSuccessful && response.header("Content-Type")?.includes("text/html")) {
      const document = response.asJsoup();
      if ((document.selectFirst("title")?.text() ?? "").includes("Content Warning") && document.selectFirst("input[name=proceed][value=View Webcomic]") != null) {
        const token = document.selectFirst("input[name=token]")?.attr("value");
        if (token != null) {
          const formBody = new URLSearchParams();
          formBody.append("token", token);
          formBody.append("proceed", "View Webcomic");

          const postRequest = POST(request.url, request.headers, formBody);
          return chain.proceed(postRequest);
        }
      }
    }

    return response;
  };
}

const SHOW_AUTHORS_NOTES_KEY = "showAuthorsNotes";
const ordinalRegex = /(?<=\d)(st|nd|rd|th)|,/g;
const dateRegex1 = /^\d{1,2}\s?\w{3,9}\s?\w{2,4}$/;
const dateRegex2 = /^\w{3,9}\s?\d{1,2}\s?\d{2,4}$/;
const dotDateRegex = /^\d{1,2}\.\d{1,2}\.\d{4}$/;

const date = ["dd MMM yyyy hh:mm aa", "dd MMM yyyy", "MMM dd yyyy", "d.M.yyyy"].map((it) => DateTimeFormatter.ofPattern(it, Locale.US));

export default class ComicFury extends HttpSource {
  // override lang string used in MangaSearch; "notext" is the No Text variant of "other"
  private get siteLang(): string {
    if (this.lang === "other" && this.name.endsWith("(No Text)")) return "notext";
    if (this.lang === "pt-BR") return "pt";
    return this.lang;
  }
  override get supportsLatest(): boolean {
    return true;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(ContentWarningInterceptor()).addChainInterceptor(TextInterceptor());
  }

  // ========================= Popular =========================
  protected popularMangaRequest(page: number): Request {
    return this.searchMangaRequest(page, "", this.filterListFor(1));
  }
  protected popularMangaParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  // ========================= Latest =========================
  protected latestUpdatesRequest(page: number): Request {
    return this.searchMangaRequest(page, "", this.filterListFor(2));
  }
  protected latestUpdatesParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  // ========================= Search =========================
  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const req = toHttpUrl(`${this.baseUrl}/search.php`).newBuilder();
    req.addQueryParameter("query", query);
    req.addQueryParameter("page", String(page));
    req.addQueryParameter("language", this.siteLang);
    for (const it of filters) {
      if (it instanceof TagsFilter) req.addEncodedQueryParameter("tags", it.state.replaceAll(", ", ","));
      else if (it instanceof SortFilter) req.addQueryParameter("sort", String(it.state));
      else if (it instanceof CompletedComicFilter) req.addQueryParameter("completed", String(this.toInt(it.state)));
      else if (it instanceof LastUpdatedFilter) req.addQueryParameter("lastupdate", String(it.state));
      else if (it instanceof ViolenceFilter) req.addQueryParameter("fv", String(it.state));
      else if (it instanceof NudityFilter) req.addQueryParameter("fn", String(it.state));
      else if (it instanceof StrongLangFilter) req.addQueryParameter("fl", String(it.state));
      else if (it instanceof SexualFilter) req.addQueryParameter("fs", String(it.state));
    }

    return GET(req.build(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const jsp = response.asJsoup();
    const list: SManga[] = [];
    for (const result of jsp.select("div.webcomic-result")) {
      const manga = SManga.create();
      manga.url = result.selectFirst("div.webcomic-result-avatar a")!.attr("href");
      manga.title = result.selectFirst("div.webcomic-result-title")!.attr("title");
      manga.thumbnail_url = result.selectFirst("div.webcomic-result-avatar a img")!.absUrl("src");
      list.push(manga);
    }
    return new MangasPage(list, jsp.selectFirst("div.search-next-page") != null);
  }

  // ========================= Filters =========================
  override getFilterList(_data: unknown = null): FilterList {
    return this.filterListFor(0);
  }

  private filterListFor(sortIndex: number): FilterList {
    return [
      new TagsFilter(),
      new Filter.Separator(),
      new SortFilter(sortIndex),
      new Filter.Separator(),
      new LastUpdatedFilter(),
      new CompletedComicFilter(),
      new Filter.Separator(),
      new Filter.Header("Flags"),
      new ViolenceFilter(),
      new NudityFilter(),
      new StrongLangFilter(),
      new SexualFilter(),
    ];
  }

  private toInt(b: boolean): number {
    return b ? 0 : 1;
  }

  // ========================= Details =========================
  protected mangaDetailsParse(response: Response): SManga {
    const jsp = response.asJsoup();
    const desDiv = jsp.selectFirst("div.description-tags");
    const manga = SManga.create();
    manga.url = urlWithoutDomain(response.url);
    // If the description-tags div is null (common on profile pages or custom layout pages),
    // fallback to the custom layouts selector (username-and-title em).
    manga.description = desDiv?.parent()?.ownText() ?? jsp.selectFirst("div.username-and-title em")?.text();
    // Fallback to parsing from the profile page's authorinfo block when description-tags is null.
    manga.genre = desDiv?.children()?.eachText()?.join(", ") ?? jsp.select("div.authorinfo:contains(Genre) a").eachText().join(", ");
    manga.author = jsp.select("a.authorname").eachText().join(", ");
    manga.initialized = true;
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/read/` + substringAfter(manga.url, "?url=") + "/archive";
  }

  // ========================= Chapters =========================
  protected override chapterListRequest(manga: SManga): Request {
    return GET(`${this.baseUrl}/read/${substringAfter(manga.url, "?url=")}/archive`);
  }

  private readonly archiveSelector = "a:has(div.archive-chapter)";
  private readonly chapterSelector = "a:has(div.archive-comic)";
  private readonly nextPageSelector = "span.vfpagecurrent + a.vfpage";

  private toSManga(element: Element, chapterHeader: string | null = null): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.absUrl("href"));
    const comicName = element.select(".archive-comic-title").text();
    chapter.name = !chapterHeader ? comicName : `${chapterHeader} - ${comicName}`;
    chapter.date_upload = this.toDate(element.select(".archive-comic-date").text());
    return chapter;
  }

  private async collect(startPage: Document, chapterHeader: string | null = null): Promise<SChapter[]> {
    const chapters: SChapter[] = [];
    let currentPage = startPage;

    while (true) {
      // Get all chapters on the current page.
      chapters.push(...currentPage.select(this.chapterSelector).map((element) => this.toSManga(element, chapterHeader)));

      // Fetch the next page and repeat. If there are no more pages, exit.
      const nextPageButton = currentPage.selectFirst(this.nextPageSelector);
      if (!nextPageButton) break;
      const url = nextPageButton.absUrl("href");
      currentPage = (await this.client.execute(GET(url, this.headers))).asJsoup();
    }

    return chapters;
  }

  protected async chapterListParse(response: Response): Promise<SChapter[]> {
    const jsp = response.asJsoup();
    const chapters: SChapter[] = [];

    const archiveElements = jsp.select(this.archiveSelector);
    if (!archiveElements.isEmpty()) {
      for (const element of archiveElements) {
        const url = element.absUrl("href");
        const chapterHeader = element.select(".archive-chapter-title").text() || element.text();
        const currentPage = (await this.client.execute(GET(url, this.headers))).asJsoup();
        chapters.push(...(await this.collect(currentPage, chapterHeader)));
      }
    } else {
      chapters.push(...(await this.collect(jsp)));
    }

    // Fallback when "Infinite Scroll View" is disabled by the author.
    // We fetch and parse the custom layout site under <slug>.webcomic.ws.
    if (chapters.length === 0) {
      const pathSegments = toHttpUrl(response.url).pathSegments;
      const readIndex = pathSegments.indexOf("read");
      const slug = readIndex !== -1 && readIndex + 1 < pathSegments.length ? pathSegments[readIndex + 1] : "";
      if (slug) {
        const customUrl = `https://${slug}.webcomic.ws/archive/comics`;
        try {
          const customDoc = (await this.client.execute(GET(customUrl, this.headers))).asJsoup();
          for (const element of customDoc.select("div.archivecomic, div.nl-archivecomic")) {
            const linkElement = element.selectFirst("a");
            if (!linkElement) continue;
            const chapterHeader = element.parent()?.previousElementSibling()?.selectFirst("h3")?.text();
            const chapter = SChapter.create();
            chapter.url = linkElement.absUrl("href");
            const comicName = linkElement.text();
            chapter.name = !chapterHeader ? comicName : `${chapterHeader} - ${comicName}`;
            const t = element.selectFirst(".comicposttime, .nl-archivecomicposttime")?.text();
            chapter.date_upload = t != null ? this.toDate(t) : 0;
            chapters.push(chapter);
          }
        } catch {
          // Ignore and return empty list
        }
      }
    }

    chapters.forEach((sChapter, index) => {
      sChapter.chapter_number = index;
    });
    return chapters.reverse();
  }

  // ========================= Pages =========================
  protected override pageListRequest(chapter: SChapter): Request {
    const url = chapter.url.startsWith("http") ? chapter.url : `${this.baseUrl}${chapter.url}`;
    return GET(url, this.headers);
  }

  protected pageListParse(response: Response): Page[] {
    const jsp = response.asJsoup();
    const pages: Page[] = [];
    const comic = jsp.selectFirst("div.is--comic-page");
    if (comic != null) {
      // Infinite Scroll layout (default)
      for (const child of comic.select("div.is--image-segment div img")) {
        pages.push(new Page(pages.length, response.url, child.attr("src")));
      }
      if (this.showAuthorsNotesPref()) {
        for (const _child of comic.select("div.is--author-notes div.is--comment-box")) {
          const author = jsp.selectFirst("a.is--comment-author")?.ownText();
          pages.push(new Page(pages.length, response.url, TextInterceptorHelper.createUrl(author != null ? `Author's Notes from ${author}` : "", jsp.selectFirst("div.is--comment-content")?.html() ?? "")));
        }
      }
    } else {
      // Custom layout fallback (Infinite Scroll disabled)
      for (const child of jsp.select("#comicimage")) {
        pages.push(new Page(pages.length, response.url, child.attr("src")));
      }
    }
    return pages;
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // START OF AUTHOR NOTES //
  private showAuthorsNotesPref() {
    return this.preferences.getBoolean(SHOW_AUTHORS_NOTES_KEY, false);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const authorsNotesPref = new SwitchPreferenceCompat();
    authorsNotesPref.key = SHOW_AUTHORS_NOTES_KEY;
    authorsNotesPref.title = "Show author's notes";
    authorsNotesPref.summary = "Enable to see the author's notes at the end of chapters (if they're there).";
    authorsNotesPref.setDefaultValue(false);
    screen.addPreference(authorsNotesPref);
  }
  // END OF AUTHOR NOTES //

  // Date stuff

  private toDate(s: string): number {
    // remove st nd rd th (e.g. from 4th) but not from AuguST, and commas
    const ret = s.replace(ordinalRegex, "").trim();

    if (ret.includes(":")) return date[0].tryParseDateTime(ret);
    if (dateRegex1.test(ret)) return date[1].tryParseDate(ret);
    if (dateRegex2.test(ret)) return date[2].tryParseDate(ret);
    if (dotDateRegex.test(ret)) return date[3].tryParseDate(ret);
    return 0;
  }
}
