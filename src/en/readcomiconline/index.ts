// Port of keiyoushi/extensions-source src/en/readcomiconline/Readcomiconline.kt
// The page list step evaluates a remotely served decryption script in QuickJS upstream; that is not ported (see pageListParse).
import {
  ClientBuilder,
  DateTimeFormatter,
  Filter,
  FilterList,
  GET,
  HttpSource,
  ListPreference,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  firstInstance,
  parseHtml,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type Element,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { UserAgentType, setRandomUserAgent } from "../../../libs/randomua/index.ts";

const QUALITY_PREF_TITLE = "Image Quality Selector";
const QUALITY_PREF = "qualitypref";
const SERVER_PREF_TITLE = "Server Preference";
const SERVER_PREF = "serverpref";
const IMAGE_REMOTE_CONFIG_DEFAULT = "https://raw.githubusercontent.com/keiyoushi/rco-script/refs/heads/main/decrypt.json";

interface RemoteConfigDTO {
  imageDecryptEval: string;
  postDecryptEval?: string | null;
  shouldVerifyLinks: boolean;
}

class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly options: [string, string][],
  ) {
    super(
      displayName,
      options.map((it) => it[0]),
    );
  }
  get selected(): string | null {
    const v = this.options[this.state][1];
    return v === "" ? null : v;
  }
}

class Status extends SelectFilter {
  constructor() {
    super("Status", [
      ["Any", ""],
      ["Completed", "Completed"],
      ["Ongoing", "Ongoing"],
    ]);
  }
}
class Genre extends Filter.TriState {
  constructor(
    name: string,
    readonly gid: string,
  ) {
    super(name);
  }
}
class GenreList extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
  get included(): string[] {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.gid);
  }
  get excluded(): string[] {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.gid);
  }
}
class YearFilter extends SelectFilter {
  constructor() {
    super("Publish Year", [["Any", ""], ...Array.from({ length: 2026 - 1920 + 1 }, (_, i) => String(2026 - i)).map((y) => [y, y] as [string, string])]);
  }
}
class PublisherFilter extends Filter.Text {
  constructor() {
    super("Publisher");
  }
}
class WriterFilter extends Filter.Text {
  constructor() {
    super("Writer");
  }
}
class ArtistFilter extends Filter.Text {
  constructor() {
    super("Artist");
  }
}
class SortFilter extends SelectFilter {
  constructor() {
    super("Sort By", [
      ["Alphabet", ""],
      ["Popularity", "MostPopular"],
      ["Latest Update", "LatestUpdate"],
      ["New Comic", "Newest"],
    ]);
  }
}

// $("select[name=\"genres\"]").map((i,el) => `Genre("${$(el).next().text().trim()}", ${i})`).get().join(',\n')
// on https://readcomiconline.li/AdvanceSearch
const getGenreList = () => [
    new Genre("Action", "1"),
    new Genre("Adventure", "2"),
    new Genre("Anthology", "38"),
    new Genre("Anthropomorphic", "46"),
    new Genre("Biography", "41"),
    new Genre("Children", "49"),
    new Genre("Comedy", "3"),
    new Genre("Crime", "17"),
    new Genre("Drama", "19"),
    new Genre("Family", "25"),
    new Genre("Fantasy", "20"),
    new Genre("Fighting", "31"),
    new Genre("Graphic Novels", "5"),
    new Genre("Historical", "28"),
    new Genre("Horror", "15"),
    new Genre("Leading Ladies", "35"),
    new Genre("LGBTQ", "51"),
    new Genre("Literature", "44"),
    new Genre("Manga", "40"),
    new Genre("Martial Arts", "4"),
    new Genre("Mature", "8"),
    new Genre("Military", "33"),
    new Genre("Mini-Series", "56"),
    new Genre("Movies & TV", "47"),
    new Genre("Music", "55"),
    new Genre("Mystery", "23"),
    new Genre("Mythology", "21"),
    new Genre("Personal", "48"),
    new Genre("Political", "42"),
    new Genre("Post-Apocalyptic", "43"),
    new Genre("Psychological", "27"),
    new Genre("Pulp", "39"),
    new Genre("Religious", "53"),
    new Genre("Robots", "9"),
    new Genre("Romance", "32"),
    new Genre("School Life", "52"),
    new Genre("Sci-Fi", "16"),
    new Genre("Slice of Life", "50"),
    new Genre("Sport", "54"),
    new Genre("Spy", "30"),
    new Genre("Superhero", "22"),
    new Genre("Supernatural", "24"),
    new Genre("Suspense", "29"),
    new Genre("Thriller", "18"),
    new Genre("Vampires", "34"),
    new Genre("Video Games", "37"),
    new Genre("War", "26"),
    new Genre("Western", "45"),
    new Genre("Zombies", "36"),
];

const dateFormat = DateTimeFormatter.ofPattern("MM/dd/yyyy", Locale.ENGLISH);
const viewsRegex = /Views:\s*([\d,]+)/;

export default class Readcomiconline extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("Referer", `${this.baseUrl}/`);
    return setRandomUserAgent(h, this.preferences, this.client, UserAgentType.DESKTOP, ["chrome"]);
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    // captchaInterceptor: a network interceptor upstream, which sees the redirect; the host follows redirects, so look at the final URL
    return builder.addChainInterceptor(async (chain) => {
      const response = await chain.proceed(chain.request());

      const location = response.header("Location");
      if (location?.startsWith("/Special/AreYouHuman") === true || new URL(response.url).pathname.startsWith("/Special/AreYouHuman")) {
        this.captchaUrl = `${this.baseUrl}/Special/AreYouHuman`;
        throw new Error("Solve captcha in WebView");
      }

      return response;
    });
  }

  private captchaUrl: string | null = null;

  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/ComicList/MostPopular?page=${page}`, this.headers);
  }

  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/ComicList/LatestUpdate?page=${page}`, this.headers);
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.attr("abs:href"));
    manga.title = element.text();
    manga.thumbnail_url = element.selectFirst("img")!.attr("abs:src");
    return manga;
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(".list-comic > .item > a:first-child").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst("ul.pager > li > a:contains(Next)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // upstream handles URLs in fetchSearchManga, so bypass KeiSource's URL handling
  override getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchSearchManga(page, query, filters);
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("http")) {
      const url = toHttpUrlOrNull(query);
      if (url != null && url.pathSegments.length >= 2 && url.pathSegments[0] === "Comic") {
        const manga = SManga.create();
        manga.url = `/Comic/${url.pathSegments[1]}`;
        const details = await this.fetchMangaDetails(manga);
        details.url = manga.url;
        details.initialized = true;
        return new MangasPage([details], false);
      }
    }
    return super.fetchSearchManga(page, query, filters);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const activeFilters = filters.length === 0 ? this.getFilterList() : filters;
    const genreList = firstInstance(activeFilters, GenreList);
    const sortOption = firstInstance(activeFilters, SortFilter).selected;
    const yearOption = firstInstance(activeFilters, YearFilter).selected;

    if (query.length === 0 && genreList.included.length === 1 && genreList.excluded.length === 0 && yearOption == null) {
      // Single included genre — use /Genre/{name}/{sort} URL
      const genreName = genreList.state.find((it) => it.isIncluded())!.name.replaceAll(" ", "-");
      const url = toHttpUrl(this.baseUrl).newBuilder();
      url.addPathSegment("Genre");
      url.addPathSegment(genreName);
      if (sortOption != null) url.addPathSegment(sortOption);
      url.addQueryParameter("page", String(page));
      return GET(url.build(), this.headers);
    } else if (query.length === 0 && genreList.included.length === 0 && genreList.excluded.length === 0 && yearOption == null) {
      // No query, no genres — publisher/writer/artist + sort
      const url = toHttpUrl(this.baseUrl).newBuilder();
      let pathSegmentAdded = false;

      for (const filter of activeFilters) {
        if (filter instanceof PublisherFilter) {
          if (filter.state.length > 0) {
            url.addPathSegments(`Publisher/${filter.state.replaceAll(" ", "-")}`);
            pathSegmentAdded = true;
          }
        } else if (filter instanceof WriterFilter) {
          if (filter.state.length > 0) {
            url.addPathSegments(`Writer/${filter.state.replaceAll(" ", "-")}`);
            pathSegmentAdded = true;
          }
        } else if (filter instanceof ArtistFilter) {
          if (filter.state.length > 0) {
            url.addPathSegments(`Artist/${filter.state.replaceAll(" ", "-")}`);
            pathSegmentAdded = true;
          }
        }

        if (pathSegmentAdded) break;
      }
      if (!pathSegmentAdded) {
        url.addPathSegment("ComicList");
        if (sortOption != null) url.addPathSegment(sortOption);
      } else if (sortOption != null) {
        url.addPathSegment(sortOption);
      }
      url.addQueryParameter("page", String(page));
      return GET(url.build(), this.headers);
    } else {
      // Has query or multiple/excluded genres — AdvanceSearch
      const url = toHttpUrl(`${this.baseUrl}/AdvanceSearch`).newBuilder();
      url.addQueryParameter("comicName", query.trim());
      url.addQueryParameter("page", String(page));
      for (const filter of activeFilters) {
        if (filter instanceof Status) {
          url.addQueryParameter("status", filter.selected ?? "");
        } else if (filter instanceof GenreList) {
          url.addQueryParameter("ig", filter.included.join(","));
          url.addQueryParameter("eg", filter.excluded.join(","));
        } else if (filter instanceof YearFilter) {
          if (filter.selected != null) url.addQueryParameter("pubDate", filter.selected);
        }
      }
      return GET(url.build(), this.headers);
    }
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const infoElement = document.selectFirst("div.barContent")!;

    const manga = SManga.create();
    manga.title = infoElement.selectFirst("a.bigChar")!.text();
    manga.artist = this.summarize(infoElement.select("p:has(span:contains(Artist:)) > a").eachText());
    manga.author = this.summarize(infoElement.select("p:has(span:contains(Writer:)) > a").eachText());
    manga.genre = infoElement.select("p:has(span:contains(Genres:)) > a").eachText().join(", ");

    const summary = infoElement
      .select("p:has(span:contains(Summary:)) ~ p")
      .map((it) => this.textPreserveLineBreaks(it))
      .join("\n\n")
      .trim();
    const publisher = infoElement.select("p:has(span:contains(Publisher:))").text();
    const publicationDate = infoElement.select("p:has(span:contains(Publication date:))").text();
    const views = viewsRegex.exec(infoElement.select("p:has(span:contains(Views:))").text());
    manga.description = [summary || null, publisher ? `\n${publisher}` : null, publicationDate || null, views ? `Views: ${views[1]}` : null].filter((it): it is string => it != null).join("\n");
    manga.status = this.parseStatus(infoElement.selectFirst("p:has(span:contains(Status:))")?.text() ?? "");
    manga.thumbnail_url = document.selectFirst(".rightBox:eq(0) img")?.absUrl("src");
    return manga;
  }

  private summarize(l: string[]): string {
    return l.length > 2 ? `${l[0]} & others` : l.join(", ");
  }

  /** Replace <br> with newline text so wholeText() keeps them as line breaks (.text() collapses them into spaces). */
  private textPreserveLineBreaks(element: Element): string {
    return parseHtml(this.host.load, element.outerHtml().replace(/<br\s*\/?>/gi, "\n"), element.baseUri).wholeText();
  }

  override getMangaUrl(manga: SManga): string {
    const url = this.captchaUrl;
    if (url != null) {
      this.captchaUrl = null;
      return url;
    }
    return `${this.baseUrl}${manga.url}`;
  }

  private parseStatus(status: string): number {
    if (status.includes("Ongoing")) return SManga.ONGOING;
    if (status.includes("Completed")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  protected chapterListParse(response: Response): SChapter[] {
    return response
      .asJsoup()
      .select("table.listing tr:gt(1)")
      .map((element) => {
        const chapter = SChapter.create();
        const urlElement = element.selectFirst("a")!;
        chapter.url = urlWithoutDomain(urlElement.attr("href"));
        chapter.name = urlElement.text();
        chapter.date_upload = dateFormat.tryParseDate(element.selectFirst("td:eq(1)")?.text());
        return chapter;
      });
  }

  protected override pageListRequest(chapter: SChapter): Request {
    const qualitySuffix = `&s=${this.serverPref()}&quality=${this.qualityPref()}&readType=1`;
    return GET(this.baseUrl + chapter.url + qualitySuffix, this.headers);
  }

  protected async pageListParse(_response: Response): Promise<Page[]> {
    if ((await this.getRemoteConfigItem()) == null) throw new Error("Failed to retrieve configuration");

    // Upstream joins the page's <script> data and evaluates remoteConfigItem.imageDecryptEval (and postDecryptEval) from
    // a remote JSON file in QuickJS to obtain the image links, then HEAD-verifies them when shouldVerifyLinks is set.
    // Executing code served by a website/remote host is not allowed here.
    throw new Error("Image links are decrypted by a remote script run in QuickJS upstream; not supported");
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new GenreList(getGenreList()),
      new Status(),
      new YearFilter(),
      new Filter.Separator(),
      new Filter.Header("Filters below are ignored when any of the above filters or the search is filled. (Although you can sort for a single genre)"),
      new SortFilter(),
      new PublisherFilter(),
      new WriterFilter(),
      new ArtistFilter(),
    );
  }

  // Preferences Code

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const qualityPref = new ListPreference(screen.context);
    qualityPref.key = QUALITY_PREF;
    qualityPref.title = QUALITY_PREF_TITLE;
    qualityPref.entries = ["High Quality", "Low Quality"];
    qualityPref.entryValues = ["hq", "lq"];
    qualityPref.summary = "%s";

    const serverPref = new ListPreference(screen.context);
    serverPref.key = SERVER_PREF;
    serverPref.title = SERVER_PREF_TITLE;
    serverPref.entries = ["Server 1", "Server 2"];
    serverPref.entryValues = ["", "s2"];
    serverPref.summary = "%s";

    screen.addPreference(qualityPref);
    screen.addPreference(serverPref);
  }

  private qualityPref() {
    return this.preferences.getString(QUALITY_PREF, "hq");
  }

  private serverPref() {
    return this.preferences.getString(SERVER_PREF, "");
  }

  private remoteConfigItem: RemoteConfigDTO | null = null;
  private async getRemoteConfigItem(): Promise<RemoteConfigDTO | null> {
    if (this.remoteConfigItem != null) return this.remoteConfigItem;

    const configLink = `${IMAGE_REMOTE_CONFIG_DEFAULT}?bust=${Date.now()}`;

    try {
      const configResponse = await this.client.execute(GET(configLink, new Headers()));
      return (this.remoteConfigItem = configResponse.parseAs<RemoteConfigDTO>());
    } catch {
      return null;
    }
  }
}
