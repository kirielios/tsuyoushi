// Port of keiyoushi/extensions-source src/all/comicskingdom/ComicsKingdom.kt (and ComicsKindomDto.kt)
import {
  CheckBoxPreference, Filter, FilterList, HttpSource, MangasPage, Page, SChapter, SManga, parseHtml, substringAfter, substringBefore, toHttpUrl, urlWithoutDomain,
  type HttpUrlBuilder, type PreferenceScreen, type Request, type Response,
} from "../../../sdk/index.ts";
import { GET } from "../../../sdk/httpsource.ts";

// ComicsKindomDto.kt
interface Chapter {
  id: number;
  date: string;
  assets: Assets | null;
  link: string;
}
interface Assets {
  single: AssetData;
}
interface AssetData {
  url: string;
}
interface Rendered {
  rendered: string;
}
interface MangaMeta {
  ck_byline_on_app: string;
}
interface Manga {
  id: number;
  link: string;
  title: Rendered;
  content: Rendered;
  meta: MangaMeta;
  yoast_head: string;
}
// Upstream: `Chapter.javaClass.fields.joinToString(",") { it.name }` reads the (field-less) companion class, so it is empty
// and the API returns every field.
const ChapterFields = "";
const MangaFields = "";

class OrderFilter extends Filter.Select<string> {
  constructor() {
    super("Order by", ["author", "date", "id", "include", "modified", "parent", "relevance", "title", "rand"]);
  }
  getValue(): string {
    return this.values[this.state];
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

const lastSegment = (url: string) => {
  const segments = toHttpUrl(url).pathSegments;
  return segments[segments.length - 1];
};

export default class ComicsKingdom extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  private readonly compactChapterCountRegex = /"totalItems":(\d+)/g;
  private readonly thumbnailUrlRegex = /thumbnailUrl":"(\S+)","dateP/;

  private readonly mangaPerPage = 20;
  private readonly chapterPerPage = 100;

  private mangaApiUrl(): HttpUrlBuilder {
    return toHttpUrl(this.baseUrl)
      .newBuilder()
      .addPathSegments("wp-json/wp/v2")
      .addPathSegment("ck_feature")
      .addQueryParameter("per_page", String(this.mangaPerPage))
      .addQueryParameter("_fields", MangaFields)
      .addQueryParameter("ck_language", this.lang === "es" ? "spanish" : "english");
  }

  private chapterApiUrl(): HttpUrlBuilder {
    return toHttpUrl(this.baseUrl).newBuilder().addPathSegments("wp-json/wp/v2").addPathSegment("ck_comic").addQueryParameter("per_page", String(this.chapterPerPage)).addQueryParameter("_fields", ChapterFields);
  }

  private getReq(orderBy: string, page: number): Request {
    return GET(this.mangaApiUrl().addQueryParameter("orderBy", orderBy).addQueryParameter("page", String(page)).build().toString(), this.headers);
  }

  protected popularMangaRequest(page: number): Request {
    return this.getReq("relevance", page);
  }
  protected latestUpdatesRequest(page: number): Request {
    return this.getReq("modified", page);
  }
  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const url = this.mangaApiUrl().addQueryParameter("search", query).addQueryParameter("page", String(page));

    if (filters.length > 0) {
      for (const filter of filters) {
        if (filter instanceof OrderFilter) {
          url.addQueryParameter("orderby", filter.getValue());
        } else if (filter instanceof GenreList) {
          if (filter.included.length > 0) url.addQueryParameter("ck_genre", filter.included.join(","));
          if (filter.excluded.length > 0) url.addQueryParameter("ck_genre_exclude", filter.excluded.join(","));
        }
      }
    }
    return GET(url.build().toString(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const list = response.parseAs<Manga[]>();
    return new MangasPage(
      list.map((it) => {
        const manga = SManga.create();
        manga.thumbnail_url = this.thumbnailUrlRegex.exec(it.yoast_head)?.[1];
        manga.url = urlWithoutDomain(this.mangaApiUrl().addPathSegment(String(it.id)).addQueryParameter("slug", lastSegment(it.link)).build().toString());
        manga.title = it.title.rendered;
        return manga;
      }),
      list.length === this.mangaPerPage,
    );
  }

  protected popularMangaParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }
  protected latestUpdatesParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const manga = SManga.create();
    const mangaData = response.parseAs<Manga>();
    manga.title = mangaData.title.rendered;
    manga.author = substringAfter(mangaData.meta.ck_byline_on_app, "By").trim();
    manga.description = parseHtml(this.host.load, mangaData.content.rendered, this.baseUrl).text();
    manga.status = SManga.UNKNOWN;
    manga.thumbnail_url = this.thumbnailUrlRegex.exec(mangaData.yoast_head)?.[1];
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/${toHttpUrl(this.baseUrl + manga.url).queryParameter("slug")}`;
  }

  protected async chapterListParse(response: Response): Promise<SChapter[]> {
    const mangaData = response.parseAs<Manga>();
    const mangaName = lastSegment(mangaData.link);

    if (this.shouldCompact()) {
      const res = await this.client.execute(GET(mangaData.link));
      const counts = [...res.text().matchAll(this.compactChapterCountRegex)].map((m) => m[1]);
      const postCount = Number(counts.find((c) => Number(c) > 0)!);
      const maxPage = Math.ceil(postCount / this.chapterPerPage);
      return Array.from({ length: Math.round(maxPage) }, (_, idx) => {
        const chapter = SChapter.create();
        chapter.chapter_number = Math.fround(idx * 0.01);
        chapter.name = `${idx * this.chapterPerPage + 1}-${postCount - (idx + 1) * this.chapterPerPage < 0 ? Math.trunc(postCount) : (idx + 1) * this.chapterPerPage}`;
        chapter.url = urlWithoutDomain(
          this.chapterApiUrl()
            .addQueryParameter("orderBy", "date")
            .addQueryParameter("order", "asc")
            .addQueryParameter("ck_feature", mangaName)
            .addQueryParameter("page", String(idx + 1))
            .build()
            .toString(),
        );
        return chapter;
      }).reverse();
    }

    const chapters: SChapter[] = [];
    let pageNum = 1;

    let chapterData: Chapter[] | null = await this.getChapterList(mangaName, pageNum);
    let chapterNum = 0;

    while (chapterData != null) {
      const list = chapterData.map((it) => {
        chapterNum = Math.fround(chapterNum + Math.fround(0.01));
        const chapter = SChapter.create();
        chapter.chapter_number = chapterNum;
        chapter.url = urlWithoutDomain(this.chapterApiUrl().addPathSegment(String(it.id)).addQueryParameter("slug", substringAfter(it.link, this.baseUrl)).build().toString());
        chapter.date_upload = new Date(it.date).getTime(); // SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss"): local time
        chapter.name = substringBefore(it.date, "T");
        return chapter;
      });
      chapters.push(...list);

      if (list.length < 100) break;

      pageNum++;
      try {
        chapterData = await this.getChapterList(mangaName, pageNum);
      } catch (exception) {
        if (chapters.length > 0) return chapters;
        throw exception; // upstream would loop again on the stale page; give up instead of spinning
      }
    }

    return chapters;
  }

  private async getChapterList(mangaName: string, page: number): Promise<Chapter[]> {
    const url = this.chapterApiUrl().addQueryParameter("order", "desc").addQueryParameter("ck_feature", mangaName).addQueryParameter("page", String(page)).build();

    const call = await this.client.execute(GET(url.toString(), this.headers));
    return JSON.parse(call.text()) as Chapter[];
  }

  override getChapterUrl(chapter: SChapter): string {
    if (this.shouldCompact()) return `${this.baseUrl}/${toHttpUrl(this.baseUrl + chapter.url).queryParameter("ck_feature")}`;
    return `${this.baseUrl}/${toHttpUrl(this.baseUrl + chapter.url).queryParameter("slug")}`;
  }

  protected pageListParse(response: Response): Page[] {
    if (this.shouldCompact()) {
      return response.parseAs<Chapter[]>().map((chapter, idx) => new Page(idx, "", chapter.assets!.single.url));
    }
    const chapter = response.parseAs<Chapter>();
    return [new Page(0, "", chapter.assets!.single.url)];
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new OrderFilter(), new GenreList(this.getGenreList()));
  }

  private getGenreList(): Genre[] {
    return [
      new Genre("Action", "action"),
      new Genre("Adventure", "adventure"),
      new Genre("Classic", "classic"),
      new Genre("Comedy", "comedy"),
      new Genre("Crime", "crime"),
      new Genre("Fantasy", "fantasy"),
      new Genre("Gag Cartoons", "gag-cartoons"),
      new Genre("Mystery", "mystery"),
      new Genre("New Arrivals", "new-arrivals"),
      new Genre("Non-Fiction", "non-fiction"),
      new Genre("OffBeat", "offbeat"),
      new Genre("Political Cartoons", "political-cartoons"),
      new Genre("Romance", "romance"),
      new Genre("Sci-Fi", "sci-fi"),
      new Genre("Slice Of Life", "slice-of-life"),
      new Genre("Superhero", "superhero"),
      new Genre("Vintage", "vintage"),
    ];
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const compactpref = new CheckBoxPreference(screen.context);
    compactpref.key = "compactPref";
    compactpref.title = "Compact chapters";
    compactpref.summary = "Unchecking this will make each daily/weekly upload into a chapter which can be very slow because some comics have 8000+ uploads";
    compactpref.setDefaultValue(true);
    screen.addPreference(compactpref);
  }

  private shouldCompact(): boolean {
    return this.preferences.getBoolean("compactPref", true);
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }
}
