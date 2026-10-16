// Port of yuzono/anime-extensions lib-multisrc/animestream/AnimeStream.kt and AnimeStreamFilters.kt (lib 16)
import {
  AnimeHttpSource,
  Base64,
  DateTimeFormatter,
  Filter,
  fromUtf8,
  GET,
  Hoster,
  ListPreference,
  Locale,
  MangasPage,
  parallelCatchingFlatMap,
  parseHtml,
  SAnime,
  SEpisode,
  urlWithoutDomain,
  Video,
  type Document,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../sdk/index.ts";

export const PREFIX_SEARCH = "path:";

// ============================== Filters ===============================
export class QueryPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toQueryPart() {
    return this.vals[this.state][1];
  }
}

export class CheckBoxFilterList extends Filter.Group<Filter.CheckBox> {
  constructor(
    name: string,
    readonly pairs: [string, string][],
  ) {
    super(
      name,
      pairs.map((it) => new Filter.CheckBox(it[0])),
    );
  }
  /** parseCheckbox: the checked options as `name[]=value`, joined by "&". */
  toQueryPart(name: string) {
    return this.state
      .filter((c) => c.state)
      .map((c) => this.pairs.find((p) => p[0] === c.name)![1])
      .filter((v) => v.trim())
      .map((v) => `${name}[]=${v}`)
      .join("&");
  }
}

// ================================ Source ================================
export abstract class AnimeStream extends AnimeHttpSource {
  protected prefQualityDefault = "720p";
  protected prefQualityKey = "preferred_quality";
  protected prefQualityTitle = "Preferred quality";
  protected prefQualityValues = ["1080p", "720p", "480p", "360p", "240p", "144p"];

  protected dateFormatter = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH);

  protected get animeListUrl() {
    return `${this.baseUrl}/anime`;
  }

  // ============================== Popular ===============================
  protected popularAnimeRequest(page: number) {
    return GET(`${this.animeListUrl}/?page=${page}&order=popular`, this.headers);
  }
  protected popularAnimeParse(response: Response) {
    return this.searchAnimeParse(response);
  }

  // =============================== Latest ===============================
  protected latestUpdatesAnimeRequest(page: number) {
    return GET(`${this.animeListUrl}/?page=${page}&order=update`, this.headers);
  }
  protected latestUpdatesAnimeParse(response: Response) {
    return this.searchAnimeParse(response);
  }

  // =============================== Search ===============================
  override async getSearchAnime(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const url = new URL(query);
      const path = url.pathname.split("/").filter(Boolean).join("/");
      if (url.host !== new URL(this.baseUrl).host || !path) throw new Error("Unsupported url");
      return this.getSearchAnime(page, PREFIX_SEARCH + path, filters);
    }
    if (query.startsWith(PREFIX_SEARCH)) {
      const response = await this.executeSuccess(GET(`${this.baseUrl}/${query.slice(PREFIX_SEARCH.length)}`, this.headers));
      const details = this.animeDetailsParse(response);
      details.url = urlWithoutDomain(response.url);
      details.initialized = true;
      return new MangasPage([details], false);
    }
    return super.getSearchAnime(page, query, filters);
  }

  // ponytail: the theme's fetched filters (genres/seasons/studios scraped from the list page) are not ported; sources bring their own.
  protected searchAnimeRequest(page: number, query: string, _filters: FilterList) {
    if (query) return GET(`${this.baseUrl}/page/${page}/?s=${encodeURIComponent(query)}`, this.headers);
    return GET(`${this.animeListUrl}/?page=${page}`, this.headers);
  }

  protected searchAnimeSelector() {
    return "div.listupd article a.tip";
  }

  protected searchAnimeFromElement(element: Element): SAnime {
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(element.attr("abs:href"));
    anime.title = element.selectFirst("div.tt, div.ttl")!.ownText();
    anime.thumbnail_url = this.imageUrlOf(element.selectFirst("img"));
    return anime;
  }

  protected searchAnimeNextPageSelector() {
    return "div.pagination a.next, div.hpage > a.r";
  }

  protected searchAnimeParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const animes = document.select(this.searchAnimeSelector()).map((e) => this.searchAnimeFromElement(e));
    return new MangasPage(animes, document.selectFirst(this.searchAnimeNextPageSelector()) != null);
  }

  // =========================== Anime Details ============================
  protected animeDetailsSelector = "div.info-content, div.right ul.data";
  protected animeAltNameSelector = ".alter";
  protected animeTitleSelector = "h1.entry-title";
  protected animeThumbnailSelector = "div.thumb > img, div.limage > img";
  protected animeGenresSelector = "div.genxed > a, li:contains(Genre:) a";
  protected animeDescriptionSelector = ".entry-content[itemprop=description], .desc";
  protected animeAdditionalInfoSelector = "div.spe > span, li:has(b)";
  protected animeStatusText = "Status";
  protected animeAuthorText = "Fansub";
  protected animeArtistText = "Studio";
  protected animeAltNamePrefix = "Alternative name(s): ";

  protected getAnimeDescription(document: Document): string | null {
    return document.select(this.animeDescriptionSelector).last()?.text() ?? null;
  }

  protected animeDetailsParse(response: Response): SAnime {
    return this.animeDetailsFromDocument(response.asJsoup());
  }

  protected animeDetailsFromDocument(document: Document): SAnime {
    const anime = SAnime.create();
    anime.url = urlWithoutDomain(document.location());
    anime.title = document.selectFirst(this.animeTitleSelector)!.text();
    anime.thumbnail_url = this.imageUrlOf(document.selectFirst(this.animeThumbnailSelector));
    const infos = document.selectFirst(this.animeDetailsSelector)!;
    anime.genre = infos.select(this.animeGenresSelector).eachText().join(", ");
    anime.status = this.parseStatus(this.getInfo(infos, this.animeStatusText));
    anime.artist = this.getInfo(infos, this.animeArtistText) ?? undefined;
    anime.author = this.getInfo(infos, this.animeAuthorText) ?? undefined;
    let description = "";
    const desc = this.getAnimeDescription(document);
    if (desc != null) description += `${desc}\n\n`;
    const alt = document.selectFirst(this.animeAltNameSelector)?.text();
    if (alt?.trim()) description += `${this.animeAltNamePrefix}${alt}\n`;
    for (const it of infos.select(this.animeAdditionalInfoSelector).eachText()) description += `${it}\n`;
    anime.description = description;
    return anime;
  }

  // ============================== Episodes ==============================
  protected episodeListSelector() {
    return "div.eplister > ul > li > a";
  }

  protected episodeListParse(response: Response): SEpisode[] {
    return response
      .asJsoup()
      .select(this.episodeListSelector())
      .map((e) => this.episodeFromElement(e));
  }

  protected episodePrefix = "Episode";

  protected getEpisodeName(_element: Element, epNum: string) {
    return `${this.episodePrefix} ${epNum}`;
  }

  protected getEpisodeNumber(epNum: string) {
    return Number.parseFloat(epNum.split(" ")[0]) || 0;
  }

  protected episodeFromElement(element: Element): SEpisode {
    const episode = SEpisode.create();
    episode.url = urlWithoutDomain(element.attr("abs:href"));
    const num = element.selectFirst(".epl-num")!.text();
    episode.name = this.getEpisodeName(element, num);
    episode.episode_number = this.getEpisodeNumber(num);
    const sub = element.selectFirst(".epl-sub")?.text();
    if (sub != null) episode.scanlator = sub;
    episode.date_upload = this.dateFormatter.tryParseDate(element.selectFirst(".epl-date")?.text());
    return episode;
  }

  // ============================ Video Links =============================
  protected videoListSelector() {
    return "select.mirror > option[data-index], ul.mirror a[data-em]";
  }

  /** videoListParse(response) on the episode page, as one hoster. */
  override async getHosterList(episode: SEpisode): Promise<Hoster[]> {
    return [new Hoster(this.getEpisodeUrl(episode), this.name)];
  }

  override async getVideoList(hoster: Hoster): Promise<Video[]> {
    const items = (await this.executeSuccess(GET(hoster.hosterUrl, this.headers))).asJsoup().select(this.videoListSelector());
    return parallelCatchingFlatMap([...items], async (element) => this.getVideoListFromUrl(await this.getHosterUrl(element), element.text()));
  }

  protected getHosterUrl(element: Element): Promise<string> {
    const tag = element.tagName();
    if (tag === "option") return this.getHosterUrlFromData(element.attr("value"));
    if (tag === "a") return this.getHosterUrlFromData(element.attr("data-em"));
    throw new Error("Unknown mirror element");
  }

  protected getEpisodeIframeSelector() {
    return "iframe[src~=.]";
  }

  protected async getHosterUrlFromData(encodedData: string): Promise<string> {
    const doc = /^https?:\/\//.test(encodedData)
      ? (await this.executeSuccess(GET(encodedData, this.headers))).asJsoup()
      : parseHtml(this.host.load, fromUtf8(Base64.decode(encodedData)), this.baseUrl);
    const iframe = doc.selectFirst(this.getEpisodeIframeSelector());
    if (iframe) return this.safeUrl(iframe, "src");
    return this.safeUrl(doc.selectFirst("meta[content~=.][itemprop=embedUrl]")!, "content");
  }

  private safeUrl(element: Element, attribute: string) {
    const value = element.attr(attribute);
    if (value.startsWith("http")) return value;
    if (value.startsWith("//")) return `https:${value}`;
    return element.absUrl(attribute) || value;
  }

  /** getVideoList(url, name): each source resolves its hosts. */
  protected async getVideoListFromUrl(_url: string, _name: string): Promise<Video[]> {
    return [];
  }

  // ============================== Settings ==============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new ListPreference(screen.context);
    p.key = this.prefQualityKey;
    p.title = this.prefQualityTitle;
    p.entries = this.prefQualityValues;
    p.entryValues = this.prefQualityValues;
    p.setDefaultValue(this.prefQualityDefault);
    p.summary = "%s";
    screen.addPreference(p);
  }

  // ============================= Utilities ==============================
  override sortVideos(videos: Video[]): Video[] {
    const quality = (this.preferences.getString(this.prefQualityKey, this.prefQualityDefault) ?? this.prefQualityDefault).toLowerCase();
    const has = (v: Video) => (v.videoTitle.toLowerCase().includes(quality) ? 1 : 0);
    return [...videos].reverse().sort((a, b) => has(b) - has(a));
  }

  protected parseStatus(statusString: string | null): number {
    switch (statusString?.trim().toLowerCase()) {
      case "completed":
      case "completo":
        return SAnime.COMPLETED;
      case "ongoing":
      case "lançamento":
        return SAnime.ONGOING;
      default:
        return SAnime.UNKNOWN;
    }
  }

  protected getInfo(element: Element, text: string): string | null {
    const span = element.selectFirst(`span:contains(${text})`);
    if (!span) return null;
    return span.selectFirst("a")?.text() ?? span.ownText();
  }

  protected imageUrlOf(element: Element | null): string | undefined {
    if (!element) return undefined;
    const url = element.hasAttr("data-src")
      ? element.attr("abs:data-src")
      : element.hasAttr("data-lazy-src")
        ? element.attr("abs:data-lazy-src")
        : element.hasAttr("srcset")
          ? element.attr("abs:srcset").split(" ")[0]
          : element.attr("abs:src");
    return url.split("?resize")[0];
  }
}
