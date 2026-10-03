// Port of keiyoushi/extensions-source src/en/alphamanga/AlphaManga.kt
import {
  Base64,
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  parseAs,
  substringAfter,
  substringBeforeLast,
  toHttpUrl,
  type ClientBuilder,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { episodeToSChapter, isLocked, mangaDataToSManga, type ChapterResponse, type SearchResponse } from "./dto.ts";
import { GenreFilter, StatusFilter } from "./filters.ts";
import { imageInterceptor } from "./interceptor.ts";

const HIDE_LOCKED_PREF_KEY = "hide_locked";

export default class AlphaManga extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(imageInterceptor(this.host));
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const genre = firstInstanceOrNull(filters, GenreFilter)?.value;
    const status = firstInstanceOrNull(filters, StatusFilter)?.value;
    const builder = toHttpUrl(`${this.baseUrl}/manga/search.json`).newBuilder().addQueryParameter("query", query);
    // a null value drops the "=" upstream (OkHttp writes just the name)
    if (status != null) builder.addQueryParameter("progress", status);
    if (genre != null) builder.addQueryParameter("genre", genre);
    const url = builder.addQueryParameter("page", String(page)).build();
    const result = (await this.client.get(url.toString())).parseAs<SearchResponse>();
    const mangas = result.data.map((it) => mangaDataToSManga(it));
    return new MangasPage(mangas, result.has_more);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF_KEY, false);
    const mangas = (async () => {
      if (!fetchDetails) return manga;
      const document = (await this.client.get(this.getMangaUrl(manga), this.desktopHeaders)).asJsoup();
      const m = SManga.create();
      m.title = document.selectFirst("h1.c-h1")!.text();
      const labels = document.select("h3.p-manga-detail__about-label");
      const labelText = (kind: string) =>
        labels
          .filter((it) => it.text().includes(kind))
          .map((it) => substringBeforeLast(it.text(), "/").trim())
          .join(", ");
      m.author = labelText("Author");
      m.artist = labelText("Illustrator");
      m.description = document.selectFirst("p.p-manga-detail__about-overview-text")?.text();
      m.genre = document
        .select(".p-manga-detail__tags .c-tag")
        .map((it) => it.text())
        .join(", ");
      switch (document.selectFirst(".p-manga-detail__status p")?.text()) {
        case "Ongoing":
          m.status = SManga.ONGOING;
          break;
        case "Completed":
          m.status = SManga.COMPLETED;
          break;
        case "Suspended":
          m.status = SManga.ON_HIATUS;
          break;
        default:
          m.status = SManga.UNKNOWN;
      }
      m.thumbnail_url = document.selectFirst("img.p-manga-detail__banner-image")?.absUrl("src");
      return m;
    })();

    const chapterList = (async () => {
      if (!fetchChapters) return chapters;
      return (await this.client.get(`${this.baseUrl}/manga/${manga.url}/episodes.json`))
        .parseAs<ChapterResponse>()
        .episodes.filter((it) => !hideLocked || !isLocked(it))
        .map((it) => episodeToSChapter(it, manga.url));
    })();

    const [details, list] = await Promise.all([mangas, chapterList]);
    return new SMangaUpdate(details, list);
  }

  // load desktop selectors
  private get desktopHeaders() {
    const h = this.headersBuilder();
    h.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36");
    return h;
  }

  // force mobile ua for high resolution images
  private get mobileHeaders() {
    const h = this.headersBuilder();
    h.set("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36");
    return h;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter), this.mobileHeaders)).asJsoup();
    const viewer = document.selectFirst("viewer-manga-vertical");
    if (!viewer) throw new Error("Log in via WebView and rent or purchase this chapter to read.");

    const pages = parseAs<string[]>(viewer.attr("v-bind:pages"));
    const keys = this.extractKeys(viewer.attr("placeholder"));

    return pages
      .filter((it) => it !== "first" && it !== "last")
      .map((url, index) => {
        const keyEncoded = Base64.encode(keys[index]);
        return new Page(index, "", `${url}#key=${keyEncoded}`);
      });
  }

  private extractKeys(s: string): Uint8Array[] {
    const raw = Base64.decode(substringAfter(s, "base64,"));
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    const keys: Uint8Array[] = [];
    let pos = 33; // right after the PNG signature + IHDR chunk
    while (pos + 2 <= raw.length) {
      const count = dv.getUint16(pos, true);
      const length = count * 8;
      const dataStart = pos + 2;
      const dataEnd = dataStart + length;
      if (dataEnd > raw.length) break;
      keys.push(raw.slice(dataStart, dataEnd));
      pos = dataEnd;
    }
    return keys;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Note: Search and active filters are applied together"), new StatusFilter(), new GenreFilter());
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/manga/${String(chapter.memo.titleId)}/${chapter.url}?mode=vertical`;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = HIDE_LOCKED_PREF_KEY;
    p.title = "Hide Locked Chapters";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }
}
