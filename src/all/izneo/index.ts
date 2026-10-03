// Port of keiyoushi/extensions-source src/all/izneo/Izneo.kt (+ IzneoAPI.kt, ImageInterceptor.kt)
import {
  Base64,
  DateTimeFormatter,
  EditTextPreference,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  Response,
  SChapter,
  SManga,
  aesCbcDecrypt,
  isBlank,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  utf8,
  type ChainInterceptor,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
  type Request,
} from "../../../sdk/index.ts";

// IzneoAPI.kt
interface Series {
  name: string;
  url: string;
  id: string;
  version: number;
  synopsis: string;
  gender: string;
  target: { name: string };
  authors: { nickname: string }[];
}
const seriesGenres = (s: Series) => `${s.gender}, ${s.target.name}`;
const seriesCover = (s: Series) => `/images/serie/${s.id}.jpg?v=${s.version}`;
const seriesToString = (s: Series) => s.synopsis.replaceAll("\n          ", " ").replaceAll("<br />", "");

interface Album {
  id: string;
  title: string;
  chapter: string;
  publicationDate: string;
  fullAvailable: boolean;
  inUserLibrary: boolean;
  inUserSubscription: boolean;
}
const albumPath = (a: Album) => `/episode-${a.chapter}-${a.id}/read/1`;
const albumIsLocked = (a: Album) => !a.fullAvailable && !(a.inUserLibrary || a.inUserSubscription);
const albumToString = (a: Album) => a.title + (albumIsLocked(a) ? " 🔒" : "");

interface AlbumPage {
  albumPageNumber: number;
  key: string;
  iv: string;
}
const urlSafe = (s: string) => s.replaceAll("+", "-").replaceAll("/", "_");
const albumPageToString = (p: AlbumPage) => `/${p.albumPageNumber}?type=full&key=${urlSafe(p.key)}&iv=${urlSafe(p.iv)}`;

// ImageInterceptor.kt
const imageInterceptor: ChainInterceptor = async (chain) => {
  const request = chain.request();
  const url = toHttpUrl(request.url);
  const key = url.queryParameter("key");
  if (key == null) return chain.proceed(request);
  const iv = url.queryParameter("iv")!;
  const stripped = url.newBuilder().removeAllQueryParameters("key").removeAllQueryParameters("iv").build().toString();
  const response = await chain.proceed({ ...request, url: stripped });
  // AES/CBC/PKCS7Padding over the whole body; the decrypted bytes are served as a JPEG
  const decoded = await aesCbcDecrypt(Base64.decode(key), Base64.decode(iv), response.bytes());
  return Response.of(response.url, decoded, "image/jpeg", response.code);
};

const ORIGIN = "https://www.izneo.com";
const LIMIT = 50;
const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT);

type Json = Record<string, unknown>;

export default class Izneo extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(imageInterceptor);
  }

  private get apiUrl() {
    return `${ORIGIN}/${this.lang}/api/catalog/detail/webtoon`;
  }

  private get username(): string {
    return this.preferences.getString("username", "")!;
  }
  private get password(): string {
    return this.preferences.getString("password", "")!;
  }

  private _apiHeaders?: Headers;
  // by lazy
  private get apiHeaders(): Headers {
    if (!this._apiHeaders) {
      const h = new Headers(this.headers);
      h.set("X-Requested-With", "XMLHttpRequest");
      // upstream concatenates the ByteArray from btoa() into the string ("Basic [B@..."), which cannot work: the intended base64 is sent
      if (this.username.length > 0 && this.password.length > 0) h.set("Authorization", `Basic ${Base64.encode(utf8(`${this.username}:${this.password}`))}`);
      this._apiHeaders = h;
    }
    return this._apiHeaders;
  }

  private seriesCount = 0;

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("Cookie", `lang=${this.lang};`);
    h.set("Referer", this.baseUrl);
    return h;
  }

  protected override latestUpdatesRequest(page: number): Request {
    return GET(`${this.apiUrl}/new?offset=${page - 1}&order=1&abo=0`, this.apiHeaders);
  }

  protected override popularMangaRequest(page: number): Request {
    return GET(`${this.apiUrl}/topSales?offset=${page - 1}&order=0&abo=0`, this.apiHeaders);
  }

  protected override searchMangaRequest(page: number, _query: string, _filters: FilterList): Request {
    return GET(`${this.apiUrl}/free?offset=${page - 1}&order=3&abo=0`, this.apiHeaders);
  }

  protected override pageListRequest(chapter: SChapter): Request {
    return GET(`${ORIGIN}/book/${this.chapterId(chapter)}`, this.apiHeaders);
  }

  override imageRequest(page: Page): Request {
    return GET(`${ORIGIN}/book/${page.imageUrl!}`, this.apiHeaders);
  }

  protected override latestUpdatesParse(response: Response): MangasPage {
    const obj = this.parse(response);
    const raw = obj["series_count"];
    // get("series_count")!! throws on a missing key; null/non-int is a primitive whose .int is an IllegalArgumentException, caught upstream
    if (raw === undefined) throw new Error("NullPointerException");
    const count = typeof raw === "number" && Number.isInteger(raw) ? raw : typeof raw === "string" && /^[+-]?\d+$/.test(raw) ? Number.parseInt(raw, 10) : null;
    if (count === null) return new MangasPage([], false);
    const series = Object.values(obj["series"] as Json).flatMap((it) => it as Series[]);
    this.seriesCount += series.length;
    if (count === this.seriesCount) this.seriesCount = 0;
    const mangas = series.map((it) => {
      const manga = SManga.create();
      manga.url = it.url;
      manga.title = it.name;
      manga.genre = seriesGenres(it);
      manga.author = it.authors.map((a) => a.nickname).join(", ");
      manga.artist = it.authors.map((a) => a.nickname).join(", ");
      manga.thumbnail_url = `${ORIGIN}/${this.lang}${seriesCover(it)}`;
      manga.description = seriesToString(it);
      return manga;
    });
    return new MangasPage(mangas, this.seriesCount !== 0);
  }

  protected override popularMangaParse(response: Response): MangasPage {
    return this.latestUpdatesParse(response);
  }

  protected override searchMangaParse(response: Response): MangasPage {
    return this.latestUpdatesParse(response);
  }

  protected override pageListParse(response: Response): Page[] {
    const data = this.parse(response)["data"] as Json;
    const id = String(data["id"]);
    return (data["pages"] as AlbumPage[]).map((page) => new Page(page.albumPageNumber, "", id + albumPageToString(page)));
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const mp = await super.fetchSearchManga(page, query, filters);
    return new MangasPage(
      mp.mangas.filter((it) => it.title.toLowerCase().includes(query.toLowerCase())),
      mp.hasNextPage,
    );
  }

  override async fetchMangaDetails(manga: SManga): Promise<SManga> {
    manga.initialized = true;
    return manga;
  }

  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const id = substringAfterLast(manga.url, "-");
    const url = `${ORIGIN}/${this.lang}/api/web/serie/${id}/chapters/old`;
    const chapters: SChapter[] = [];
    let cutoff = 0;
    let current = LIMIT;
    while (current === LIMIT) {
      const albums = this.parse(await this.client.execute(GET(`${url}/${cutoff}/${LIMIT}`, this.apiHeaders)))["albums"] as Album[];
      for (const album of albums) {
        const chapter = SChapter.create();
        chapter.url = manga.url + albumPath(album);
        chapter.name = albumToString(album);
        chapter.date_upload = this.albumTimestamp(album);
        chapter.chapter_number = Number(album.chapter);
        chapters.push(chapter);
      }
      cutoff += LIMIT;
      current = albums.length;
    }
    return chapters;
  }

  override getMangaUrl(manga: SManga): string {
    return ORIGIN + manga.url;
  }

  override getChapterUrl(chapter: SChapter): string {
    return ORIGIN + chapter.url;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const username = new EditTextPreference(screen.context);
    username.key = "username";
    username.title = "Username";
    screen.addPreference(username);

    // upstream also sets inputType = TYPE_TEXT_VARIATION_PASSWORD, which the settings form cannot express
    const password = new EditTextPreference(screen.context);
    password.key = "password";
    password.title = "Password";
    screen.addPreference(password);
  }

  // SimpleDateFormat.parse reads a prefix and ignores the rest
  private albumTimestamp(album: Album): number {
    return dateFormat.tryParseDate(/^\d{4}-\d{2}-\d{2}/.exec(album.publicationDate)?.[0] ?? album.publicationDate);
  }

  private chapterId(chapter: SChapter): string {
    return substringBefore(substringAfterLast(chapter.url, "-"), "/");
  }

  private parse(response: Response): Json {
    const json = JSON.parse(response.text()) as Json;
    if (json["status"] === "error") {
      if (String(json["code"]) === "4") throw new Error("You are not authorized to view this");
      throw new Error(json["data"] == null ? undefined : String(json["data"]));
    }
    return json;
  }

  override mangaDetailsRequest(_manga: SManga): never {
    throw new Error("UnsupportedOperationException");
  }
  protected override chapterListRequest(_manga: SManga): never {
    throw new Error("UnsupportedOperationException");
  }
  protected override mangaDetailsParse(_response: Response): never {
    throw new Error("UnsupportedOperationException");
  }
  protected override chapterListParse(_response: Response): never {
    throw new Error("UnsupportedOperationException");
  }
  protected override imageUrlParse(_response: Response): never {
    throw new Error("UnsupportedOperationException");
  }
}
