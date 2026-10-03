// Port of keiyoushi/extensions-source src/all/buondua/BuonDua.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  substringAfter,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type FilterList as FilterListType,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { UserAgentType, setRandomUserAgent } from "../../../libs/randomua/index.ts";

const PREF_SPLIT_PAGES = "pref_split_pages";
const DEFAULT_SPLIT_PAGES = true;

// SimpleDateFormat("HH:mm dd-MM-yyyy", Locale.US)
const DATE_FORMAT = DateTimeFormatter.ofPattern("HH:mm dd-MM-yyyy", Locale.US);

const titlePageRegex = / - \( Page \d+ \/ \d+ \)/g;

class TagFilter extends Filter.Text {
  constructor() {
    super("Tag ID");
  }
}

export default class BuonDua extends KeiSource {
  private get baseUrlHost() {
    return new URL(this.baseUrl).host;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(10, 1000, (url) => url.host === this.baseUrlHost);
  }

  protected override configureHeaders(headers: Headers): Headers {
    return setRandomUserAgent(headers, this.preferences, this.client, UserAgentType.MOBILE);
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseMangasPage(await this.client.get(`${this.baseUrl}/?start=${20 * (page - 1)}`));
  }

  // Popular
  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangasPage(await this.client.get(`${this.baseUrl}/hot?start=${20 * (page - 1)}`));
  }

  // Search
  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const tagFilter = firstInstanceOrNull(filters, Filter.Text);
    if (query.length > 0) {
      const url = toHttpUrl(this.baseUrl)!.newBuilder().addQueryParameter("search", query).addQueryParameter("start", String(20 * (page - 1))).build();
      return this.parseMangasPage(await this.client.get(url.toString()));
    }
    if (tagFilter != null && tagFilter.state.length > 0) {
      return this.parseMangasPage(await this.client.get(`${this.baseUrl}/tag/${tagFilter.state}&start=${20 * (page - 1)}`));
    }
    return this.getPopularManga(page);
  }

  private parseMangasPage(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas: SManga[] = [];
    for (const element of document.select(".blog > div")) {
      const link = element.selectFirst(".item-content .item-link");
      if (link == null) continue;
      const manga = SManga.create();
      manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
      manga.title = link.text();
      manga.url = urlWithoutDomain(link.attr("abs:href"));
      mangas.push(manga);
    }
    const hasNextPage = document.selectFirst(".pagination-next:not([disabled])") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Deeplink
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== this.baseUrlHost) return null;
    const manga = SManga.create();
    manga.url = urlWithoutDomain(url.toString());
    const details = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    details.url = manga.url;
    details.initialized = true;
    return details;
  }

  // Details
  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document), this.parseChapterList(document));
  }

  private parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    const header = document.selectFirst(".article-header")?.text();
    if (header != null) manga.title = header.replace(titlePageRegex, "").trim();

    const articleInfo = document.select(".article-info > strong").text().replace("Buondua", "").trim();

    const password = document.select("code").text();
    const downloadAvailable = document.select(".article-links a[href]");
    const downloadLinks = downloadAvailable
      .map((element) => {
        const serviceText = element.text();
        const link = element.attr("href");
        return `[${serviceText}](${link})`;
      })
      .join("\n");

    let description = "";
    if (articleInfo.trim()) description += articleInfo;
    if (downloadLinks.trim()) {
      if (description.length > 0) description += "\n\n";
      description += downloadLinks;
    }
    if (password.trim()) {
      if (description.length > 0) description += "\n\n";
      description += password;
    }
    manga.description = description.trim();

    const tags = document.selectFirst(".article-tags")?.select(".tags > .tag")
      .map((it) => substringAfter(it.text(), "#"))
      .join(", ");
    manga.genre = tags?.trim() ? tags : undefined;
    return manga;
  }

  // Chapters
  private parseChapterList(doc: Document): SChapter[] {
    const dateUploadStr = doc.selectFirst(".article-info > small")?.text();
    const dateUpload = DATE_FORMAT.tryParseDateTime(dateUploadStr);

    const basePageUrl = doc.location();

    if (this.splitPages) {
      const maxPage = this.getLastPageNum(doc);
      const chapters: SChapter[] = [];
      for (let page = maxPage; page >= 1; page--) {
        const url = toHttpUrlOrNull(basePageUrl)?.newBuilder().setQueryParameter("page", String(page)).build().toString();
        if (url == null) continue;
        const c = SChapter.create();
        c.url = urlWithoutDomain(url);
        c.name = `Page ${page}`;
        c.chapter_number = page;
        c.date_upload = dateUpload;
        chapters.push(c);
      }
      return chapters;
    }
    const c = SChapter.create();
    c.chapter_number = 0;
    c.url = urlWithoutDomain(basePageUrl);
    c.name = "Gallery";
    c.date_upload = dateUpload;
    return [c];
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}${chapter.url}`;
  }

  // Related
  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const response = await this.client.get(this.getMangaUrl(manga));
    return this.parseMangasPage(response).mangas;
  }

  // Pages
  private readonly pageListSelector = ".article-fulltext img";

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return this.splitPages ? this.pageListParse(document) : this.pageListMerge(document);
  }

  private pageListParse(document: Document): Page[] {
    return document.select(this.pageListSelector).map((imgEl, i) => new Page(i, "", imgEl.attr("abs:src")));
  }

  private async pageListMerge(document: Document): Promise<Page[]> {
    const basePageUrl = document.location();
    const maxPage = this.getLastPageNum(document);

    const urls = await Promise.all(
      Array.from({ length: maxPage }, (_, i) => i + 1).map(async (page) => {
        let doc: Document;
        if (page === 1) doc = document;
        else {
          const pageUrl = toHttpUrl(basePageUrl).newBuilder().setQueryParameter("page", String(page)).build();
          doc = (await this.client.get(pageUrl.toString())).asJsoup();
        }
        return doc.select(this.pageListSelector).map((imgEl) => imgEl.absUrl("src"));
      }),
    );
    return urls.flat().map((url, index) => new Page(index, "", url));
  }

  private getLastPageNum(doc: Document): number {
    const href = doc.select("nav.pagination:first-of-type a.pagination-next").last()?.attr("abs:href");
    if (!href || !href.startsWith("http")) return 1;
    const p = toHttpUrlOrNull(href)?.queryParameter("page");
    return p != null && /^[+-]?\d+$/.test(p) ? Number.parseInt(p, 10) : 1;
  }

  // Filters
  override getFilterList(_data: unknown = null): FilterListType {
    return FilterList(new Filter.Header("NOTE: Ignored if using text search!"), new Filter.Separator(), new TagFilter());
  }

  // Settings
  private get splitPages(): boolean {
    return this.preferences.getBoolean(PREF_SPLIT_PAGES, DEFAULT_SPLIT_PAGES);
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat();
    p.key = PREF_SPLIT_PAGES;
    p.title = "Split into multiple pages";
    // summaryOff = "Single gallery", summaryOn = "Multiple pages": the reader shows one static summary
    p.summary = "Multiple pages / Single gallery";
    p.setDefaultValue(DEFAULT_SPLIT_PAGES);
    screen.addPreference(p);
  }
}
