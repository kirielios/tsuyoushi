// Port of keiyoushi/extensions-source src/en/weebcentral/WeebCentral.kt
import {
  ClientBuilder,
  FilterList,
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  tryParseInstant,
  urlWithoutDomain,
  type Element,
} from "../../../sdk/index.ts";
import {
  AdultContentFilter,
  AnimeAdaptationFilter,
  AuthorFilter,
  OfficialTranslationFilter,
  SortFilter,
  SortOrderFilter,
  StatusFilter,
  TagFilter,
  TypeFilter,
  isUriFilter,
} from "./filters.ts";

// The related "&limit=" query parameter of the api is currently non functional
// and always returns 32 entries per request
const FETCH_LIMIT = 32;

const excludedSearchCharacters = /[!#:(),-]/g;

const seasonRegex = /(Season|S)\s*\d+/i;

export default class WeebCentral extends KeiSource {
  private get baseUrlHost() {
    return new URL(this.baseUrl).host;
  }

  protected configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(1, 2_000, (it) => it.host === this.baseUrlHost);
  }

  // Origin causes some thumbnails to mismatch
  protected configureHeaders(headers: Headers): Headers {
    headers.delete("Origin");
    return headers;
  }

  // ============================== Popular ===============================

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", this.defaultFilterList(new SortFilter("Popularity")));
  }

  // =============================== Latest ===============================

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", this.defaultFilterList(new SortFilter("Latest Updates")));
  }

  // =============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const filterList = filters.length > 0 ? filters : this.getFilterList();
    const builder = HttpUrl.parse(`${this.baseUrl}/search/data`).newBuilder();
    builder.addQueryParameter("text", query.replace(excludedSearchCharacters, " ").trim());
    filterList.filter(isUriFilter).forEach((it) => it.addToUri(builder));
    builder.addQueryParameter("limit", String(FETCH_LIMIT));
    builder.addQueryParameter("offset", String((page - 1) * FETCH_LIMIT));
    builder.addQueryParameter("display_mode", "Full Display");
    const url = builder.build();

    const document = (await this.client.get(url.toString())).asJsoup();
    const mangas = document.select("article > section > a").map((element) => {
      const manga = SManga.create();
      manga.thumbnail_url = this.sourceImg(element) ?? undefined;
      manga.title = element.selectFirst("div:not([class]):last-child")!.text();
      manga.url = urlWithoutDomain(element.attr("abs:href"));
      return manga;
    });
    const hasNextPage = document.selectFirst("button") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  protected async getMangaByUrl(u: URL): Promise<SManga | null> {
    const url = HttpUrl.parse(u.toString());
    if (url.host !== this.baseUrlHost || url.pathSegments.length < 3) {
      return null;
    }

    const manga = SManga.create();
    manga.url = `/series/${url.pathSegments[1]}/${url.pathSegments[2]}`;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    return result;
  }

  // =============================== Filters ==============================

  getFilterList(_data: unknown = null): FilterList {
    return this.defaultFilterList(new SortFilter());
  }

  // =========================== Manga Updates ============================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [m, c] = await Promise.all([fetchDetails ? this.getMangaDetails(manga) : manga, fetchChapters ? this.getChapterList(manga) : chapters]);
    return new SMangaUpdate(m, c);
  }

  private async getMangaDetails(manga: SManga): Promise<SManga> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();

    const result = SManga.create();
    {
      const it = document.select("section[x-data] > section")[0];
      result.thumbnail_url = this.sourceImg(it) ?? undefined;
      result.author = it
        .select("ul > li:has(strong:contains(Author)) > span > a")
        .map((a) => a.text())
        .join(", ");
      result.genre = it
        .select("ul > li:has(strong:contains(Tag),strong:contains(Type)) a")
        .map((a) => a.text())
        .join(", ");
      result.status = this.parseStatus(it.selectFirst("ul > li:has(strong:contains(Status)) > a"));
    }

    {
      const it = document.select("section[x-data] > section")[1];
      result.title = it.selectFirst("h1")!.text();

      let description = "";
      const desc = it.selectFirst("li:has(strong:contains(Description)) > p")?.text();
      if (desc != null) description += desc.replaceAll("NOTE: ", "\n\nNOTE: ");

      const relatedSeries = it.select("li:has(strong:contains(Related Series)) li");
      if (relatedSeries.length > 0) {
        description += "\n\nRelated Series(s):";
        relatedSeries.forEach((series) => {
          const link = series.selectFirst("a")!;
          const relation = series.selectFirst("span")?.text() ?? "";
          description += `\n- [${link.text()}](${link.attr("abs:href")}) ${relation}`.trimEnd();
        });
      }

      const alternateTitles = it.select("li:has(strong:contains(Associated Name)) li");
      if (alternateTitles.length > 0) {
        description += "\n\nAssociated Name(s):";
        alternateTitles.forEach((t) => (description += `\n- ${t.text()}`));
      }

      const trackers = document.select("li:has(strong:contains(Track)) span[data-tip] > a");
      if (trackers.length > 0) {
        description += "\n\nTracker(s):";
        trackers.forEach((tracker) => {
          const name = tracker.parent()!.attr("data-tip");
          description += `\n- [${name}](${tracker.attr("abs:href")})`;
        });
      }
      result.description = description;
    }

    result.url = urlWithoutDomain(document.location());
    return result;
  }

  // =========================== Related Manga ============================

  get supportsRelatedMangas(): boolean {
    return true;
  }

  async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();

    const currentId = HttpUrl.parse(document.location()).pathSegments[1];
    const coverTemplate = this.sourceImg(document);

    const relatedSeries = document.select("li:has(strong:contains(Related Series)) li > a").map((element) => {
      const m = SManga.create();
      const seriesId = HttpUrl.parse(element.attr("abs:href")).pathSegments[1];
      m.title = element.text();
      m.thumbnail_url = coverTemplate?.replaceAll(currentId, seriesId);
      m.url = urlWithoutDomain(element.attr("abs:href"));
      return m;
    });

    const recommendations = document.select("section:has(> h2 strong:contains(Recommendations)) li.glide__slide > a").map((element) => {
      const m = SManga.create();
      m.thumbnail_url = this.sourceImg(element) ?? undefined;
      m.title = element.selectFirst("div.truncate")!.text();
      m.url = urlWithoutDomain(element.attr("abs:href"));
      return m;
    });

    return [...relatedSeries, ...recommendations];
  }

  private parseStatus(element: Element | null): number {
    switch (element?.text()?.toLowerCase()) {
      case "ongoing":
        return SManga.ONGOING;
      case "complete":
        return SManga.COMPLETED;
      case "hiatus":
        return SManga.ON_HIATUS;
      case "canceled":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const seriesId = HttpUrl.parse(this.baseUrl + manga.url).pathSegments[1];
    const url = `${this.baseUrl}/series/${seriesId}/full-chapter-list`;

    const document = (await this.client.get(url)).asJsoup();

    // Descending
    const chapters = document.select("div[x-data] > a");

    let useIndexing = false;
    return chapters.map((element, index) => {
      const chapter = SChapter.create();
      chapter.name = element.selectFirst("span.flex > span")!.text();
      useIndexing = seasonRegex.test(chapter.name);
      chapter.url = urlWithoutDomain(element.attr("abs:href"));
      const time = element.selectFirst("time[datetime]");
      if (time) chapter.date_upload = tryParseInstant(time.attr("datetime"));
      if (useIndexing) chapter.chapter_number = chapters.length - index;

      const isOfficial = element.select("img").some((it) => it.attr("src").toLowerCase().includes("official"));
      chapter.scanlator = isOfficial ? "Official" : "Unknown";
      return chapter;
    });
  }

  // =============================== Pages ================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const parsed = HttpUrl.parseOrNull(this.baseUrl + chapter.url);
    const newUrl = parsed?.newBuilder().addPathSegment("images").addQueryParameter("is_prev", "False").addQueryParameter("reading_style", "long_strip").build().toString() ?? this.baseUrl + chapter.url;

    const document = (await this.client.get(newUrl)).asJsoup();
    return document.select("section[x-data~=scroll] > img").map((element, index) => new Page(index, "", element.attr("abs:src")));
  }

  imageRequest(page: Page): { url: string; headers: Headers } {
    const imgHeaders = this.headersBuilder();
    imgHeaders.append("Accept", "image/avif,image/webp,*/*");
    imgHeaders.append("Host", new URL(page.imageUrl!).host);

    return { url: page.imageUrl!, headers: imgHeaders };
  }

  // ============================= Utilities ==============================

  private sourceImg(element: Element): string | null {
    return element.selectFirst("source")?.attr("srcset")?.replaceAll("small", "normal") ?? element.selectFirst("img")?.attr("abs:src") ?? null;
  }

  private defaultFilterList(sortFilter: SortFilter): FilterList {
    return FilterList(
      sortFilter,
      new SortOrderFilter(),
      new OfficialTranslationFilter(),
      new AnimeAdaptationFilter(),
      new AdultContentFilter(),
      new AuthorFilter(),
      new StatusFilter(),
      new TypeFilter(),
      new TagFilter(),
    );
  }
}
