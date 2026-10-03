// Port of keiyoushi/extensions-source src/all/tappytoon/Tappytoon.kt (+ TappytoonAPI.kt DTOs)
import { Filter, FilterList, HttpUrl, KeiSource, MangasPage, Page, Response, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, substringAfter, substringBefore, tryParseInstant, type ClientBuilder } from "../../../sdk/index.ts";

// ---- TappytoonAPI.kt
interface Accessible {
  isAccessible: boolean;
}
const accessible = <A extends Accessible>(list: A[]): A[] => list.filter((it) => it.isAccessible);

interface Name {
  name: string;
}
interface Comic extends Accessible {
  id: number;
  title: string;
  slug: string;
  longDescription: string;
  posterThumbnailUrl: string;
  isHiatus: boolean;
  isCompleted: boolean;
  ageRating: Name;
  genres: Name[];
  authors: Name[];
}
const comicToString = (c: Comic) => `${c.slug}|${c.id}`;

interface ApiChapter extends Accessible {
  id: number;
  order: number;
  title: string;
  subtitle: string;
  isFree: boolean;
  isUserUnlocked: boolean;
  isUserRented: boolean;
  willAccessibleAt: string;
}
function chapterToString(c: ApiChapter): string {
  let s = c.title;
  if (c.subtitle.length > 0) s += ` - ${c.subtitle}`;
  if (!c.isFree && !(c.isUserUnlocked || c.isUserRented)) s += " 🔒";
  return s;
}

interface NextData {
  props: { initialState: { axios: { headers: { Authorization: string; "X-Device-Uuid": string } } } };
}

const IMG_CONTENT_TYPE = "image/jpeg";
const apiUrl = HttpUrl.parse("https://api-global.tappytoon.com");

const genres: Record<string, string> = {
  "<select>": "",
  Action: "action",
  Romance: "romance",
  Fantasy: "fantasy",
  School: "school",
  "Slice of Life": "slice",
  BL: "bl",
  Comedy: "comedy",
  GL: "gl",
};

class Genre extends Filter.Select<string> {
  constructor(values: string[]) {
    super("Genre", values);
  }
  get alias(): string {
    return genres[this.values[this.state]];
  }
}

export default class Tappytoon extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(async (chain) => {
      const res = await chain.proceed(chain.request());
      const mime = res.header("Content-Type");
      if (res.isSuccessful) {
        if (mime !== "application/octet-stream") return res;
        // Fix image content type
        return Response.of(res.url, res.bytes(), IMG_CONTENT_TYPE, res.code);
      }
      // Throw JSON error if available
      if (mime === "application/json") throw new Error(res.parseAs<{ message: string }>().message);
      throw new Error(`HTTP error ${res.code}`);
    });
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("User-Agent", this.host.userAgent);
    headers.set("Referer", "https://www.tappytoon.com/");
    headers.set("Origin", "https://www.tappytoon.com");
    return headers;
  }

  private _apiHeaders: Headers | null = null;

  private async apiHeaders(): Promise<Headers> {
    if (this._apiHeaders) return this._apiHeaders;
    const data = (await this.client.get(this.baseUrl)).asJsoup().selectFirst("#__NEXT_DATA__")!;
    const axiosHeaders = JSON.parse(data.data()) as NextData;
    const h = new Headers(this.headers);
    h.set("Accept-Language", this.lang);
    h.set("Authorization", axiosHeaders.props.initialState.axios.headers.Authorization);
    h.set("X-Device-Uuid", axiosHeaders.props.initialState.axios.headers["X-Device-Uuid"]);
    return (this._apiHeaders = h);
  }

  private nextUrl: string | null = null;

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const url = apiUrl.newBuilder().addEncodedPathSegment("comics").addEncodedQueryParameter("day_of_week", this.day).addEncodedQueryParameter("locale", this.lang).build();
    return this.parseComics(await this.client.get(url.toString(), await this.apiHeaders()));
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    const url = apiUrl
      .newBuilder()
      .addEncodedPathSegment("comics")
      .addEncodedQueryParameter("sort_by", "trending")
      // Sort is only available for completed series
      .addEncodedQueryParameter("filter", "completed")
      .addEncodedQueryParameter("locale", this.lang)
      .build();
    return this.parseComics(await this.client.get(url.toString(), await this.apiHeaders()));
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let url: string;
    if (this.nextUrl != null && page > 1) url = HttpUrl.parse(this.nextUrl).toString();
    else {
      const b = apiUrl.newBuilder();
      b.addEncodedPathSegments("comics");
      b.addEncodedQueryParameter("locale", this.lang);
      const genre = firstInstanceOrNull(filters, Genre);
      if (genre != null && genre.state !== 0) {
        b.addEncodedQueryParameter("genre", genre.alias);
        b.addEncodedQueryParameter("limit", "50");
      } else if (query.trim() !== "") b.addQueryParameter("keyword", query);
      url = b.build().toString();
    }

    const response = await this.client.get(url, await this.apiHeaders());
    const link = response.header("Link");
    this.nextUrl = link != null ? substringBefore(substringAfter(link, "<"), ">") : null;
    const result = this.parseComics(response);
    return new MangasPage(result.mangas, link != null);
  }

  private parseComics(response: Response): MangasPage {
    const mangas = accessible(response.parseAs<Comic[]>()).map((it) => {
      const manga = SManga.create();
      manga.url = comicToString(it);
      manga.title = it.title;
      manga.description = it.longDescription;
      manga.thumbnail_url = it.posterThumbnailUrl;
      manga.author = it.authors.map((a) => a.name).join(", ");
      manga.artist = manga.author;
      manga.genre = `${it.genres.map((g) => g.name).join(", ")}, Rating: ${it.ageRating.name}`;
      manga.status = it.isCompleted ? SManga.COMPLETED : !it.isHiatus ? SManga.ONGOING : SManga.UNKNOWN;
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  // The real URL for the webview
  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/comics/${this.slug(manga)}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(manga, chapters);

    const url = apiUrl.newBuilder().addEncodedPathSegments(`comics/${this.mangaId(manga)}/chapters`).addEncodedQueryParameter("locale", this.lang).build();

    const chapterList = accessible((await this.client.get(url.toString(), await this.apiHeaders())).parseAs<ApiChapter[]>())
      .reverse()
      .map((it) => {
        const chapter = SChapter.create();
        chapter.name = chapterToString(it);
        chapter.url = String(it.id);
        chapter.chapter_number = it.order + 1;
        chapter.date_upload = tryParseInstant(it.willAccessibleAt);
        return chapter;
      });

    return new SMangaUpdate(manga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = apiUrl
      .newBuilder()
      .addEncodedPathSegments("content-delivery/contents")
      .addEncodedQueryParameter("chapterId", chapter.url)
      .addEncodedQueryParameter("variant", "high")
      .addEncodedQueryParameter("locale", this.lang)
      .build();

    const media = (await this.client.get(url.toString(), await this.apiHeaders())).parseAs<{ media: { path: string }[] }>().media;
    return media.map((img, idx) => new Page(idx, "", img.path));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return [new Filter.Header("NOTE: can't be used with text search!"), new Genre(Object.keys(genres))];
  }

  private slug(manga: SManga): string {
    return substringBefore(manga.url, "|");
  }

  private mangaId(manga: SManga): string {
    return substringAfter(manga.url, "|");
  }

  private get day(): string {
    return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date().getDay()];
  }
}
