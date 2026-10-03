// Port of keiyoushi/extensions-source src/all/comikey/Comikey.kt
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  substringAfter,
  substringBefore,
  toHttpUrl,
  tryParseInstant,
  urlWithoutDomain,
  parseAs,
  type ClientBuilder,
  type Document,
  type Element,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { Intl } from "../../../libs/i18n/index.ts";
import { isReadable, type ComikeyComic, type ComikeyEpisode, type ComikeyEpisodeListResponse } from "./dto.ts";
import { getComikeyFilters, isUriFilter } from "./filters.ts";
import { messages } from "./messages.ts";

const PREF_HIDE_LOCKED_CHAPTERS = "hide_locked_chapters";

export default class Comikey extends KeiSource {
  private get defaultLanguage(): string {
    return this.baseUrl === "https://br.comikey.com" ? "pt-BR" : "en";
  }

  private readonly gundamUrl = "https://gundam.comikey.net";

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(3);
  }

  private _intl?: Intl;
  private get intl(): Intl {
    return (this._intl ??= new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "pt-BR"], messages }));
  }

  override async getPopularManga(page: number): Promise<MangasPage> {
    return this.parsePopularManga(await this.client.get(`${this.baseUrl}/comics/?order=-views&page=${page}`));
  }

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parsePopularManga(await this.client.get(`${this.baseUrl}/comics/?page=${page}`));
  }

  private parsePopularManga(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("div.series-listing[data-view=list] > ul > li").map((it) => this.searchMangaFromElement(it));
    const hasNextPage = document.selectFirst("ul.pagination li.next-page:not(.disabled)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== toHttpUrl(this.baseUrl).host) throw new Error("Unsupported url");
    const segments = url.pathname.slice(1).split("/");
    if (segments.length < 3) return null;
    const slug = `${segments[1]}/${segments[2]}`;
    return this.parseMangaDetails((await this.client.get(`${this.baseUrl}/comics/${slug}`)).asJsoup());
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/comics/`).newBuilder();
    if (page > 1) url.addQueryParameter("page", String(page));

    if (query.length >= 2) url.addQueryParameter("q", query);

    (filters.length === 0 ? this.getFilterList() : filters).filter(isUriFilter).forEach((it) => it.addToUri(url));

    return this.parsePopularManga(await this.client.get(url.build().toString()));
  }

  private searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const it = element.selectFirst("div.series-data span.title a")!;
    manga.url = urlWithoutDomain(it.attr("abs:href"));
    manga.title = it.text();

    manga.description = `${element.select("div.excerpt p").text()}\n\n${element.select("div.desc p").text()}`;
    manga.genre = element
      .select("ul.category-listing li a")
      .map((a) => a.text())
      .join(", ");
    manga.thumbnail_url = element.selectFirst("div.image picture img")?.attr("abs:src");
    return manga;
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    return new SMangaUpdate(this.parseMangaDetails(document), fetchChapters ? await this.parseChapterList(document) : chapters);
  }

  private parseMangaDetails(document: Document): SManga {
    const data = parseAs<ComikeyComic>(document.selectFirst("script#comic")!.data());

    const manga = SManga.create();
    manga.url = data.link;
    manga.title = data.name;
    manga.author = data.author.map((it) => it.name).join(", ");
    manga.artist = data.artist.map((it) => it.name).join(", ");
    manga.description = `"${data.excerpt}"\n\n${data.description}`;
    manga.thumbnail_url = `${this.baseUrl}${data.full_cover}`;
    const updateStatus = data.update_status;
    if (updateStatus === 0) {
      // HACK: Comikey Brasil
      if (data.update_text.toLowerCase().startsWith("toda")) manga.status = SManga.ONGOING;
      else if (["em pausa", "hiato"].some((it) => data.update_text.toLowerCase().startsWith(it))) manga.status = SManga.ON_HIATUS;
      else manga.status = SManga.UNKNOWN;
    } else if (updateStatus === 1) manga.status = SManga.COMPLETED;
    else if (updateStatus === 3) manga.status = SManga.ON_HIATUS;
    else if (updateStatus >= 4 && updateStatus <= 14) manga.status = SManga.ONGOING;
    // daily, weekly, bi-weekly, monthly, every day of the week
    else manga.status = SManga.UNKNOWN;

    const genres = data.tags.map((it) => it.name);
    switch (data.format) {
      case 0:
        genres.push("Comic");
        break;
      case 1:
        genres.push("Manga");
        break;
      case 2:
        genres.push("Webtoon");
        break;
    }
    manga.genre = genres.join(", ");
    return manga;
  }

  private async parseChapterList(document: Document): Promise<SChapter[]> {
    const segments = toHttpUrl(document.location()).pathSegments;
    const mangaSlug = segments[1];
    const mangaData = parseAs<ComikeyComic>(document.selectFirst("script#comic")!.data());
    const defaultChapterPrefix = mangaData.format === 2 ? "episode" : "chapter";

    const chapterUrlBuilder = toHttpUrl(this.gundamUrl).newBuilder();
    const mangaId = segments[2];
    const gundamScript = document.selectFirst("script:containsData(GUNDAM.token)")?.data();
    const gundamToken = gundamScript != null ? substringBefore(substringAfter(gundamScript, '= "'), '";') : null;

    if (gundamToken != null) chapterUrlBuilder.addPathSegment("comic");
    else chapterUrlBuilder.addPathSegment("comic.public");

    chapterUrlBuilder.addPathSegment(mangaId);
    chapterUrlBuilder.addPathSegment("episodes");
    chapterUrlBuilder.addQueryParameter("language", this.lang.toLowerCase());
    if (gundamToken != null) chapterUrlBuilder.addQueryParameter("token", gundamToken);
    const chapterUrl = chapterUrlBuilder.build();

    const data = (await this.client.get(chapterUrl.toString())).parseAs<ComikeyEpisodeListResponse>();
    const currentTime = Date.now();

    return (data.episodes ?? [])
      .filter((it) => isReadable(it) || !this.hideLockedChapters)
      .map((it) => {
        const chapter = SChapter.create();
        chapter.url = `/read/${mangaSlug}/${this.makeEpisodeSlug(it, defaultChapterPrefix)}/`;
        let name = it.title;
        if (it.subtitle != null) name += `: ${it.subtitle}`;
        chapter.name = name;
        chapter.chapter_number = it.number ?? 0;
        chapter.date_upload = tryParseInstant(it.releasedAt);
        return chapter;
      })
      .filter((it) => it.date_upload <= currentTime)
      .reverse();
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const out: SManga[] = [];
    for (const it of doc.select("div.similar-series li")) {
      const a = it.selectFirst("a");
      if (!a) continue;

      const m = SManga.create();
      m.url = urlWithoutDomain(a.attr("abs:href"));
      const title = a.attr("title");
      if (!title.trim()) continue;
      m.title = title;
      m.thumbnail_url = it.selectFirst("img")?.absUrl("src");
      out.push(m);
    }
    return out;
  }

  override getPageList(_chapter: SChapter): Promise<Page[]> {
    // Upstream loads the chapter in a WebView, runs a script that reads Firebase App Check's token from IndexedDB and
    // decrypts the E4P manifest through the page's own scripts. Executing site code is not ported (see the brief), so
    // it ends where upstream's WebView timeout does.
    throw new Error(this.intl.get("error_timed_out_decrypting_image_links"));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return getComikeyFilters(this.intl);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = PREF_HIDE_LOCKED_CHAPTERS;
    p.title = this.intl.get("pref_hide_locked_chapters");
    p.setDefaultValue(false);
    screen.addPreference(p);
  }

  private get hideLockedChapters(): boolean {
    return this.preferences.getBoolean(PREF_HIDE_LOCKED_CHAPTERS, false);
  }

  private makeEpisodeSlug(episode: ComikeyEpisode, defaultChapterPrefix: string): string {
    const parts = episode.id.split("-");
    const e4pid = parts.length > 1 ? episode.id.slice(episode.id.indexOf("-") + 1) : episode.id;
    let chapterPrefix: string;
    if (defaultChapterPrefix === "chapter" && this.lang !== this.defaultLanguage) {
      switch (this.lang) {
        case "es":
          chapterPrefix = "capitulo-espanol";
          break;
        case "pt-br":
          chapterPrefix = "capitulo-portugues";
          break;
        case "fr":
          chapterPrefix = "chapitre-francais";
          break;
        case "id":
          chapterPrefix = "bab-bahasa";
          break;
        default:
          chapterPrefix = "chapter";
      }
    } else chapterPrefix = defaultChapterPrefix;

    return `${e4pid}/${chapterPrefix}-${String(episode.number ?? 0).replace(/\.0$/, "").replaceAll(".", "-")}`;
  }
}
