// Port of keiyoushi/extensions-source src/all/mangapluscreators/MangaPlusCreators.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  HttpUrl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  isNotBlank,
  parseAs,
  substringAfter,
  substringAfterLast,
  urlWithoutDomain,
  type Document,
  type Element,
  type Response,
} from "../../../sdk/index.ts";

// Port of MangaPlusCreatorsDto.kt
interface MpcResponse {
  status: string;
  titles?: MpcTitle[] | null;
}
interface MpcTitle {
  title: string;
  thumbnail: string;
  is_one_shot: boolean;
  author: MpcAuthorDto;
  latest_episode: MpcLatestEpisode;
}
interface MpcAuthorDto {
  name: string;
}
interface MpcLatestEpisode {
  title_connect_id: string;
}
interface MpcReaderDataPages {
  pc: MpcReaderPage[];
}
interface MpcReaderPage {
  page_no: number;
  image_url: string;
}
interface MpcReaderDataTitle {
  title: string;
  thumbnail: string;
  is_oneshot: boolean;
  contents_id: string;
}
class ChaptersPage {
  constructor(
    readonly chapters: SChapter[],
    readonly hasNextPage: boolean,
  ) {}
}

const CHAPTER_DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ENGLISH);
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36";

class SelectFilterOption {
  constructor(
    readonly name: string,
    readonly value: string,
  ) {}
}

abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: SelectFilterOption[],
    defaultValue = 0,
  ) {
    super(
      name,
      options.map((it) => it.name),
      defaultValue,
    );
  }
  get selected(): string {
    return this.options[this.state].value;
  }
}

class SortFilter extends SelectFilter {
  constructor() {
    super("Sort", [new SelectFilterOption("Popularity", ""), new SelectFilterOption("Date", "latest_desc"), new SelectFilterOption("Likes", "like_desc")], 0);
  }
}

class GenreFilter extends SelectFilter {
  constructor() {
    super(
      "Genres",
      [
        new SelectFilterOption("Fantasy", "fantasy"),
        new SelectFilterOption("Action", "action"),
        new SelectFilterOption("Romance", "romance"),
        new SelectFilterOption("Horror", "horror"),
        new SelectFilterOption("Slice of Life", "slice_of_life"),
        new SelectFilterOption("Comedy", "comedy"),
        new SelectFilterOption("Sports", "sports"),
        new SelectFilterOption("Sci-Fi", "sf"),
        new SelectFilterOption("Mystery", "mystery"),
        new SelectFilterOption("Others", "others"),
      ],
      0,
    );
  }
}

const toFloatOrNull = (s: string): number | null => (s.trim() !== "" && !isNaN(Number(s)) ? Number(s) : null);

export default class MangaPlusCreators extends KeiSource {
  private get apiUrl() {
    return `${this.baseUrl}/api`;
  }

  protected configureHeaders(headers: Headers): Headers {
    headers.set("User-Agent", USER_AGENT);
    return headers;
  }

  // POPULAR Section
  async getPopularManga(_page: number): Promise<MangasPage> {
    const popularUrl = `${this.baseUrl}/titles/popular/?p=m&l=${this.lang}`;
    return this.parseMangasPageFromElement(await this.client.get(popularUrl), "div.item-recent");
  }

  private parseMangasPageFromElement(response: Response, selector: string): MangasPage {
    const result = response.asJsoup();

    const mangas = result.select(selector).map((element) => this.popularElementToSManga(element));

    return new MangasPage(mangas, false);
  }

  private popularElementToSManga(element: Element): SManga {
    const titleThumbnailUrl = element.selectFirst(".image-area img")!.attr("src");
    const titleContentId = HttpUrl.parse(titleThumbnailUrl).pathSegments[2];
    const manga = SManga.create();
    manga.title = element.selectFirst(".title-area .title")!.text();
    manga.thumbnail_url = titleThumbnailUrl;
    manga.url = `/titles/${titleContentId}`;
    return manga;
  }

  // LATEST Section
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const apiUrl = HttpUrl.parse(`${this.apiUrl}/titles/recent/`).newBuilder().addQueryParameter("page", String(page)).addQueryParameter("l", this.lang).addQueryParameter("t", "episode").build();

    const result = (await this.client.get(apiUrl.toString())).parseAs<MpcResponse>();

    const titles = (result.titles ?? []).map((title) => this.mpcTitleToSManga(title));

    // TODO: handle last page of latest
    return new MangasPage(titles, result.status !== "error");
  }

  private mpcTitleToSManga(t: MpcTitle): SManga {
    const manga = SManga.create();
    manga.title = t.title;
    manga.thumbnail_url = t.thumbnail;
    manga.url = `/titles/${t.latest_episode.title_connect_id}`;
    manga.author = t.author.name; // TODO: maybe not required
    return manga;
  }

  // SEARCH Section
  protected async getMangasByUrl(u: URL, _page: number): Promise<MangasPage> {
    const url = HttpUrl.parse(u.toString());
    if (!["mangaplus-creators.jp", "medibang.com"].includes(url.host)) {
      return new MangasPage([], false);
    }
    const pathIndex = url.host === "medibang.com" ? 1 : 0;
    const idIndex = pathIndex + 1;
    if (url.pathSegments.length <= idIndex) {
      return new MangasPage([], false);
    }
    const id = url.pathSegments[idIndex];
    switch (url.pathSegments[pathIndex]) {
      case "episodes": {
        const result = (await this.client.get(`${this.baseUrl}/episodes/${id}`)).asJsoup();
        const readerElement = result.selectFirst("div[react=viewer]")!;
        const dataTitle = readerElement.attr("data-title");
        const dataTitleResult = parseAs<MpcReaderDataTitle>(dataTitle);
        return new MangasPage([this.readerDataTitleToSManga(dataTitleResult)], false);
      }
      case "authors": {
        const result = (await this.client.get(`${this.baseUrl}/authors/${id}`)).asJsoup();
        const elements = result.select("#works .manga-list li .md\\:block");
        const smangas = elements.map((element) => {
          const titleThumbnailUrl = element.selectFirst(".image-area img")!.attr("src");
          const titleContentId = HttpUrl.parse(titleThumbnailUrl).pathSegments[2];
          const manga = SManga.create();
          manga.title = element.selectFirst("p.text-white")!.text();
          manga.thumbnail_url = titleThumbnailUrl;
          manga.url = `/titles/${titleContentId}`;
          return manga;
        });
        return new MangasPage(smangas, false);
      }
      case "titles": {
        const titleUrl = `${this.baseUrl}/titles/${id}`;
        const result = (await this.client.get(titleUrl)).asJsoup();
        const bookBox = result.selectFirst(".book-box")!;
        const title = SManga.create();
        title.title = bookBox.selectFirst("div.title")!.text();
        title.thumbnail_url = bookBox.selectFirst("div.cover img")!.attr("data-src");
        title.url = urlWithoutDomain(titleUrl);
        return new MangasPage([title], false);
      }
      default:
        return new MangasPage([], false);
    }
  }

  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (isNotBlank(query)) {
      // TODO: maybe this needn't be a new builder and just similar to `popularUrl` above?
      const searchUrl = HttpUrl.parse(`${this.baseUrl}/keywords`).newBuilder().addQueryParameter("q", query).addQueryParameter("s", "date").addQueryParameter("lang", this.lang).build();

      return this.parseMangasPageFromElement(await this.client.get(searchUrl.toString()), "div.item-search");
    }

    // nothing to search, filters active -> browsing /genres instead
    // TODO: check if there's a better way (filters is independent of search but part of it)
    const genreUrl = HttpUrl.parse(this.baseUrl).newBuilder();
    genreUrl.addPathSegment("genres");
    genreUrl.addQueryParameter("l", this.lang);
    filters.forEach((filter) => {
      if (filter instanceof SortFilter) {
        if (filter.selected.length > 0) {
          genreUrl.addQueryParameter("s", filter.selected);
        }
      } else if (filter instanceof GenreFilter) genreUrl.addPathSegment(filter.selected);
      // Nothing else is supported for now
    });

    return this.parseMangasPageFromElement(await this.client.get(genreUrl.build().toString()), "div.item-recent");
  }

  private readerDataTitleToSManga(t: MpcReaderDataTitle): SManga {
    const manga = SManga.create();
    manga.title = t.title;
    manga.thumbnail_url = t.thumbnail;
    manga.url = `/titles/${t.contents_id}`;
    return manga;
  }

  // MANGA Section
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(this.getMangaUrl(manga)).then((it) => this.mangaDetailsParse(it.asJsoup())) : manga,
      fetchChapters ? this.getChapterList(manga) : chapters,
    ]);
    return new SMangaUpdate(details, chapterList);
  }

  private mangaDetailsParse(result: Document): SManga {
    const bookBox = result.selectFirst(".book-box")!;

    const manga = SManga.create();
    manga.title = bookBox.selectFirst("div.title")!.text();
    manga.author = bookBox.selectFirst("div.mod-btn-profile div.name")!.text();
    manga.description = bookBox
      .select("div.summary p")
      .map((it) => it.text())
      .join("\n\n");
    switch (bookBox.selectFirst("div.book-submit-type")!.text()) {
      case "Series":
        manga.status = SManga.ONGOING;
        break;
      case "One-shot":
        manga.status = SManga.COMPLETED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    manga.genre = bookBox
      .select("div.genre-area div.tag-genre")
      .map((it) => it.text())
      .join(", ");
    manga.thumbnail_url = bookBox.selectFirst("div.cover img")!.attr("data-src");
    return manga;
  }

  // CHAPTER Section
  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const titleContentId = HttpUrl.parse(this.baseUrl + manga.url).pathSegments[1];
    const chapterListResponse = this.chapterListPageParse(await this.client.get(this.chapterListPageUrl(1, titleContentId)));
    const chapterListResult = [...chapterListResponse.chapters];

    let hasNextPage = chapterListResponse.hasNextPage;
    let page = 1;
    while (hasNextPage) {
      page += 1;
      const nextPageResult = this.chapterListPageParse(await this.client.get(this.chapterListPageUrl(page, titleContentId)));
      if (nextPageResult.chapters.length === 0) {
        break;
      }
      chapterListResult.push(...nextPageResult.chapters);
      hasNextPage = nextPageResult.hasNextPage;
    }

    return chapterListResult.reverse();
  }

  private chapterListPageUrl(page: number, titleContentId: string) {
    return `${this.baseUrl}/titles/${titleContentId}/?page=${page}`;
  }

  private chapterListPageParse(response: Response): ChaptersPage {
    const result = response.asJsoup();
    const chapters = result.select(".mod-item-series").map((element) => this.chapterElementToSChapter(element));
    const hasResult = result.select(".mod-pagination .next").length > 0;
    return new ChaptersPage(chapters, hasResult);
  }

  private chapterElementToSChapter(element: Element): SChapter {
    const episode = substringAfterLast(element.attr("href"), "/");
    const latestUpdatedDate = element.selectFirst(".first-update")!.text();
    const chapterNumberElement = element.selectFirst(".number")!.text();
    const chapterNumber = toFloatOrNull(substringAfter(chapterNumberElement, "#"));
    const chapter = SChapter.create();
    chapter.url = `/episodes/${episode}`;
    chapter.date_upload = CHAPTER_DATE_FORMAT.tryParseDate(latestUpdatedDate);
    chapter.name = chapterNumberElement;
    chapter.chapter_number = chapterNumberElement === "One-shot" ? 0 : (chapterNumber ?? -1);
    return chapter;
  }

  // PAGES & IMAGES Section
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const refererUrl = this.getChapterUrl(chapter);
    const result = (await this.client.get(refererUrl)).asJsoup();
    const readerElement = result.selectFirst("div[react=viewer]")!;
    const dataPages = readerElement.attr("data-pages");
    return parseAs<MpcReaderDataPages>(dataPages).pc.map((page) => new Page(page.page_no, refererUrl, page.image_url));
  }

  imageRequest(page: Page): { url: string; headers: Headers } {
    const request = super.imageRequest(page);
    request.headers.delete("Origin");
    request.headers.set("Referer", page.url);
    return request;
  }

  // FILTERS Section
  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Separator(), new Filter.Header("NOTE: Ignored if using text search!"), new Filter.Separator(), new SortFilter(), new GenreFilter(), new Filter.Separator());
  }
}
