// Port of keiyoushi/extensions-source src/all/manta/MantaComics.kt
import { Filter, KeiSource, MangasPage, Page, SManga, SMangaUpdate, SChapter, SwitchPreferenceCompat, toHttpUrl, type FilterList, type PreferenceScreen, type Response } from "../../../sdk/index.ts";
import {
  coverToString,
  descriptionAsString,
  detailsArtists,
  detailsAuthors,
  episodeAsString,
  episodeTimestamp,
  isLocked,
  nameAsString,
  seriesToSManga,
  type Details,
  type Episode,
  type MantaResponse,
  type RelatedSeries,
  type Series,
  type Title,
  type Token,
} from "./dto.ts";
import { Category, categoryOf } from "./filters.ts";

const PREF_SHOW_LOCKED = "show_locked_chapters";
const BLACK_IMAGE_MARKER = "just-black.jpg";

export default class MantaComics extends KeiSource {
  private get apiUrl() {
    return `https://${new URL(this.baseUrl).hostname}`;
  }

  override get supportsLatest() {
    return false;
  }

  protected override configureHeaders(headers: Headers) {
    headers.set("Origin", this.apiUrl);
    headers.set("Accept-Language", this.lang);
    return headers;
  }

  // ============================== Popular ===============================

  async getPopularManga(_page: number): Promise<MangasPage> {
    const url = `${this.apiUrl}/manta/v1/search/series?cat=New&lang=${this.lang}`;

    return this.parseSearchManga(await this.client.get(url));
  }

  // =============================== Latest ===============================

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // =============================== Search ===============================

  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.apiUrl}/manta/v1/search/series`).newBuilder();
    builder.addQueryParameter("lang", this.lang);
    if (query.length > 0) {
      builder.addQueryParameter("q", query);
    } else {
      const category = categoryOf(filters);
      const selected = category[1].length === 0 ? "tagId=288" : category[1];
      const [key, value] = selected.split("=");
      builder.addQueryParameter(key, value);
    }
    const url = builder.build();

    return this.parseSearchManga(await this.client.get(url.toString()));
  }

  private parseSearchManga(response: Response): MangasPage {
    const list = response.parseAs<MantaResponse<Series<Title>[]>>().data.map((it) => seriesToSManga(it, this.lang));
    return new MangasPage(list, false);
  }

  // =========================== Related Manga ============================

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const seriesUrl = `${this.apiUrl}/front/v1/series/${manga.url}?lang=${this.lang}`;
    const related = (await this.client.get(seriesUrl)).parseAs<MantaResponse<RelatedSeries>>().data;
    return (related.data.relatedSeriesList ?? []).map((it) => seriesToSManga(it, this.lang));
  }

  // =========================== Manga Details / Chapters ============================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const host = url.hostname;
    const baseHost = new URL(this.baseUrl).hostname;
    if (host !== baseHost && host !== `www.${baseHost}`) return null;

    const segments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    const seriesIdx = segments.indexOf("series");
    if (seriesIdx === -1 || seriesIdx >= segments.length - 1) return null;

    const id = segments[seriesIdx + 1];
    const manga = SManga.create();
    manga.url = id;
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const seriesUrl = `${this.apiUrl}/front/v1/series/${manga.url}?lang=${this.lang}`;
    const response = await this.client.get(seriesUrl, this.headers);
    const mantaResponse = response.parseAs<MantaResponse<Series<Details>>>();
    const series = mantaResponse.data;
    const details = series.data;

    const mangaDetails = SManga.create();
    mangaDetails.description = descriptionAsString(details.description);
    mangaDetails.genre = details.tags.map((it) => nameAsString(it.name, this.lang)).join(", ");
    mangaDetails.artist = detailsArtists(details)
      .map((it) => it.name)
      .join(", ");
    mangaDetails.author = detailsAuthors(details)
      .map((it) => it.name)
      .join(", ");
    mangaDetails.status = details.isCompleted === true ? SManga.COMPLETED : SManga.ONGOING;
    mangaDetails.initialized = true;

    const showLocked = this.preferences.getBoolean(PREF_SHOW_LOCKED, true);
    const chapterList = (series.episodes ?? [])
      .filter((it: Episode) => showLocked || !isLocked(it.lockData))
      .map((it) => {
        const chapter = SChapter.create();
        chapter.name = episodeAsString(it, this.lang);
        chapter.url = String(it.id);
        chapter.date_upload = episodeTimestamp(it);
        chapter.chapter_number = it.ord;
        return chapter;
      })
      .reverse();

    return new SMangaUpdate(mangaDetails, chapterList);
  }

  // ============================= Page List ==============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = `${this.apiUrl}/front/v1/episodes/${chapter.url}?lang=${this.lang}`;

    let token: string | null | undefined = this.client.cookieJar.loadForRequest(url).find((it) => it.name === "token")?.value;
    if (token != null) {
      const h = this.headersBuilder();
      h.set("Authorization", `Bearer ${token}`);

      token = (await this.client.get(`${this.apiUrl}/manta/v1/login`, h)).parseAs<MantaResponse<Token>>().data.token;
    }

    let headers: Headers;
    if (token != null) {
      headers = this.headersBuilder();
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      headers = this.headers;
    }

    const response = await this.client.get(url, headers);
    const images = (response.parseAs<MantaResponse<Episode>>().data.cutImages ?? []).map((it) => it.downloadUrl);
    // Locked chapters return real preview images followed by "just-black.jpg" placeholders.
    const previewImages = images.filter((it) => !it.includes(BLACK_IMAGE_MARKER));

    const pages = previewImages.map((img, idx) => new Page(idx, "", img));

    if (previewImages.length < images.length) {
      pages.push(new Page(pages.length, "", this.previewEndImageUrl));
    }
    return pages;
  }

  private get previewEndImageUrl(): string {
    let heading: string;
    let subHeading: string;
    if (this.lang === "es") {
      heading = "Fin de la vista previa del capítulo";
      subHeading = "Compra e inicia sesión con WebView y borra la caché del capítulo para leer completo";
    } else {
      heading = "End of chapter preview";
      subHeading = "Purchase and login via webview and clear chapter cache to read full";
    }
    return toHttpUrl("https://fakeimg.ryd.tools/1500x2126/f4f4f4/222222/")
      .newBuilder()
      .addQueryParameter("text", `${heading}\n\n${subHeading}`)
      .addQueryParameter("font_size", "58")
      .build()
      .toString();
  }

  // ============================ Preferences =============================

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = PREF_SHOW_LOCKED;
    pref.title = this.lang === "es" ? "Mostrar capítulos de pago/bloqueados" : "Show paid/locked chapters";
    pref.summary = this.lang === "es" ? "Muestra los capítulos de pago o bloqueados en la lista de capítulos" : "Show paid or locked chapters in the chapter list";
    pref.setDefaultValue(true);
    screen.addPreference(pref);
  }

  // ============================== Filters ===============================

  override getFilterList(_data: unknown = null): FilterList {
    return [new Filter.Header("Filters are ignored when searching"), new Filter.Separator(), new Category(this.lang)];
  }

  // ============================= Utilities ==============================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/episodes/${chapter.url}`;
  }
}
