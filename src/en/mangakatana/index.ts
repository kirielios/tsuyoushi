// Port of keiyoushi/extensions-source src/en/mangakatana/MangaKatana.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  ListPreference,
  Locale,
  MangasPage,
  Page,
  Response,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstance,
  substringAfterLast,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { ChaptersFilter, GenreInclusionMode, GenreList, SortFilter, StatusFilter, TypeFilter, genres } from "./filters.ts";

const dateFormat = DateTimeFormatter.ofPattern("MMM-dd-yyyy", Locale.US);

export default class MangaKatana extends KeiSource {
  // ponytail: upstream reads "SERVER_PREFERENCE" but the screen key is "server_preference" (a change listener copies
  // one to the other); the host only writes the screen key, so read that one.
  private readonly serverPreference = "server_preference";

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(async (chain) => {
      const originalResponse = await chain.proceed(chain.request());
      if (originalResponse.header("Content-Type")?.includes("application/octet-stream")) {
        const extension = substringAfterLast(chain.request().url, ".");
        return Response.of(originalResponse.url, originalResponse.bytes(), `image/${extension}`, originalResponse.code);
      }
      return originalResponse;
    });
  }

  private readonly imageArrayNameRegex = /data-src['"],\s*(\w+)/;
  private readonly imageUrlRegex = /'([^']*)'/g;

  private mangaFromItem(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.selectFirst("div.text > h3 > a")!.absUrl("href"));
    manga.title = element.selectFirst("div.text > h3 > a")!.ownText();
    manga.thumbnail_url = element.selectFirst("img")!.absUrl("src");
    return manga;
  }

  // Latest

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/page/${page}`)).asJsoup();
    const mangas = document.select("div#book_list > div.item").map((element) => this.mangaFromItem(element));
    const hasNextPage = document.selectFirst("a.next.page-numbers") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Popular (is actually alphabetical)

  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/manga/page/${page}`)).asJsoup();
    const mangas = document.select("div#book_list > div.item").map((element) => this.mangaFromItem(element));
    const hasNextPage = document.selectFirst("a.next.page-numbers") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Search

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let url: string;
    if (query.length > 0) {
      const type = firstInstance(filters, TypeFilter);
      url = toHttpUrl(`${this.baseUrl}/page/${page}`).newBuilder().addQueryParameter("search", query).addQueryParameter("search_by", type.toUriPart()).build().toString();
    } else {
      const builder = toHttpUrl(`${this.baseUrl}/manga/page/${page}`).newBuilder();
      builder.addQueryParameter("filter", "1");
      for (const filter of filters) {
        if (filter instanceof GenreList) {
          const includedGenres: string[] = [];
          const excludedGenres: string[] = [];
          filter.state.forEach((it) => {
            if (it.isIncluded()) includedGenres.push(it.id);
            else if (it.isExcluded()) excludedGenres.push(it.id);
          });
          if (includedGenres.length > 0) builder.addQueryParameter("include", includedGenres.join("_"));
          if (excludedGenres.length > 0) builder.addQueryParameter("exclude", excludedGenres.join("_"));
        } else if (filter instanceof GenreInclusionMode) {
          builder.addQueryParameter("include_mode", filter.toUriPart());
        } else if (filter instanceof SortFilter) {
          builder.addQueryParameter("order", filter.toUriPart());
        } else if (filter instanceof StatusFilter) {
          if (filter.toUriPart().length > 0) builder.addQueryParameter("status", filter.toUriPart());
        } else if (filter instanceof ChaptersFilter) {
          switch (filter.state.trim()) {
            case "-1":
              builder.addQueryParameter("chapters", "e1");
              break;
            case "":
              builder.addQueryParameter("chapters", "1");
              break;
            default:
              builder.addQueryParameter("chapters", filter.state.trim());
          }
        }
      }
      url = builder.build().toString();
    }

    const response = await this.client.get(url);
    const pathSegments = new URL(response.url).pathname.slice(1).split("/").map(decodeURIComponent);
    const document = response.asJsoup();
    if (pathSegments[0] === "manga" && pathSegments[1] !== "page") {
      const manga = SManga.create();
      manga.thumbnail_url = this.parseThumbnail(document);
      manga.title = document.selectFirst("h1.heading")!.text();
      manga.url = urlWithoutDomain(response.url);
      return new MangasPage([manga], false);
    }
    const mangas = document.select("div#book_list > div.item").map((element) => this.mangaFromItem(element));
    const hasNextPage = document.selectFirst("a.next.page-numbers") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Details

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsFromDocument(document), this.chapterListFromDocument(document));
  }

  private mangaDetailsFromDocument(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst("h1.heading")!.text();
    manga.author = document.select(".author").eachText().join(", ");
    const altName = document.select(".alt_name").text();
    manga.description = document.select(".summary > p").text() + (altName.length > 0 ? `\n\nAlt name(s): ${altName}` : "");
    manga.status = this.parseStatus(document.selectFirst(".value.status")?.text());
    manga.genre = document
      .select(".genres > a")
      .map((it) => it.text())
      .join(", ");
    manga.thumbnail_url = this.parseThumbnail(document);
    return manga;
  }

  private parseThumbnail(document: Document): string | undefined {
    return document.selectFirst("div.media div.cover img")?.attr("abs:src");
  }

  private parseStatus(status: string | null | undefined): number {
    if (status == null) return SManga.UNKNOWN;
    if (status.includes("Ongoing")) return SManga.ONGOING;
    if (status.includes("Completed")) return SManga.COMPLETED;
    return SManga.UNKNOWN;
  }

  // Chapters

  private chapterListFromDocument(document: Document): SChapter[] {
    return document.select("tr:has(.chapter)").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
      chapter.name = element.selectFirst("a")!.text();
      chapter.date_upload = dateFormat.tryParseDate(element.selectFirst(".update_time")?.text());
      return chapter;
    });
  }

  // Deep link

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    if (pathSegments[0] !== "manga" || pathSegments.length < 2) return null;
    const mangaUrl = `${this.baseUrl}/manga/${pathSegments[1]}`;
    const document = (await this.client.get(mangaUrl)).asJsoup();
    const manga = this.mangaDetailsFromDocument(document);
    manga.url = urlWithoutDomain(mangaUrl);
    return manga;
  }

  // Page List

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const sv = this.preferences.getString(this.serverPreference, "");
    const serverSuffix = sv?.trim() ? `?sv=${sv}` : "";
    const document = (await this.client.get(this.getChapterUrl(chapter) + serverSuffix)).asJsoup();
    const imageScript = document.select("script:containsData(data-src)").first()?.data();
    if (imageScript === undefined) return [];
    const imageArrayName = this.imageArrayNameRegex.exec(imageScript)?.[1];
    if (imageArrayName === undefined) return [];
    const imageArrayRegex = new RegExp(`var ${imageArrayName}=\\[([^\\[]*)]`);

    const arr = imageArrayRegex.exec(imageScript)?.[1];
    if (arr === undefined) return [];
    return [...arr.matchAll(this.imageUrlRegex)].map((mr, i) => new Page(i, "", mr[1]));
  }

  // Preferences

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const serverPref = new ListPreference(screen.context);
    serverPref.key = "server_preference";
    serverPref.title = "Server preference";
    serverPref.entries = ["Server 1", "Server 2", "Server 3"];
    serverPref.entryValues = ["", "mk", "3"];
    serverPref.setDefaultValue("");
    serverPref.summary = "%s";

    screen.addPreference(serverPref);
  }

  // Filters

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("NOTE: Other filters ignored if using text search!"),
      new TypeFilter(),
      new Filter.Separator(),
      new GenreList(genres),
      new GenreInclusionMode(),
      new SortFilter(),
      new StatusFilter(),
      new Filter.Separator(),
      new Filter.Header("Input -1 to search for only oneshots"),
      new ChaptersFilter(),
    );
  }
}
