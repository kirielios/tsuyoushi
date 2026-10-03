// Port of keiyoushi/extensions-source src/all/hdoujin/HDoujin.kt
import {
  ClientBuilder, EditTextPreference, FilterList, HttpClient, HttpSource, ListPreference, MangasPage, Page, SChapter, SManga, SwitchPreferenceCompat, toHttpUrl, urlWithoutDomain,
  type PreferenceScreen, type Request, type Response,
} from "../../../sdk/index.ts";
import { GET, POST } from "../../../sdk/httpsource.ts";
import { CategoryFilter, SelectFilter, TagType, TextFilter, getFilters } from "./filters.ts";
import { entryToSManga, mangaDetailToSManga, type DataKey, type Entries, type ImagesInfo, type MangaData, type MangaDetail } from "./dto.ts";

const PREF_REM_ADD = "pref_remove_additional";
const PREF_IMAGE_RES = "pref_image_quality";
const PREF_INCLUDE_TAGS = "pref_include_tags";
const PREF_EXCLUDE_TAGS = "pref_exclude_tags";

const shortenTitleRegex = /(\[[^\]]*\]|[({][^)}]*[)}])/g;

export default class HDoujin extends HttpSource {
  private get siteLang(): string {
    switch (this.lang) {
      case "en":
        return "english";
      case "es":
        return "spanish";
      case "ja":
        return "japanese";
      case "ko":
        return "korean";
      case "zh":
        return "chinese";
      default:
        return this.lang;
    }
  }

  override get supportsLatest() {
    return true;
  }
  private quality = () => this.preferences.getString(PREF_IMAGE_RES, "1280")!;
  private remadd = () => this.preferences.getBoolean(PREF_REM_ADD, false);
  private alwaysIncludeTags = () => this.preferences.getString(PREF_INCLUDE_TAGS, "");
  private alwaysExcludeTags = () => this.preferences.getString(PREF_EXCLUDE_TAGS, "");
  private getTagsPreference(): string {
    const include = this.alwaysIncludeTags()
      ?.split(",")
      .map((it) => it.trim())
      .filter((it) => it.trim() !== "");

    const exclude = this.alwaysExcludeTags()
      ?.split(",")
      .map((it) => it.trim())
      .filter((it) => it.trim() !== "")
      .map((it) => `-${it}`);

    const tags: string[] = include ? [...include, ...(exclude ?? [])] : exclude ? [...exclude, ...(include ?? [])] : [];
    if (tags.length > 0) {
      const tagGroups = new Map<string, Set<string>>();
      for (const it of tags) {
        const tag = it.startsWith("-") ? it.slice(1) : it;
        const i = tag.indexOf(":");
        const parts = i === -1 ? [tag] : [tag.slice(0, i), tag.slice(i + 1)];
        const key = parts.length === 2 && parts[0].trim() !== "" ? parts[0] : "tag";
        const t = (it.startsWith("-") ? it.slice(1) : it).split(":").at(-1)!.trim();
        const set = tagGroups.get(key) ?? new Set<string>();
        set.add(it.startsWith("-") ? `-${t}` : t);
        tagGroups.set(key, set);
      }

      return [...tagGroups.entries()].map(([key, values]) => `${key}:"${[...values].join(",")}"`).join(" ");
    }
    return "";
  }

  private get baseApiUrl(): string {
    return `https://api.${this.baseUrl.replace(/^https:\/\//, "")}`;
  }
  private get bookApiUrl(): string {
    return `${this.baseApiUrl}/books`;
  }

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("Referer", `${this.baseUrl}/`);
    h.set("Origin", this.baseUrl);
    return h;
  }

  private _clearance: string | null = null;

  /**
   * Upstream loads "$baseUrl/" in a WebView, lets the site's scripts run and reads localStorage 'clearance'.
   * Executing the site's code is not ported, so no token is ever obtained and the clearance client throws
   * "Open webview to refresh token" (page lists).
   */
  getClearance(): string | null {
    return this._clearance;
  }

  private _clearanceClient?: HttpClient;
  private get clearanceClient(): HttpClient {
    return (this._clearanceClient ??= new HttpClient(
      this.host,
      () => this.headers,
      new ClientBuilder()
        .addChainInterceptor(async (chain) => {
          const request = chain.request();
          const clearance = this.getClearance();
          if (clearance == null) throw new Error("Open webview to refresh token");

          const newUrl = toHttpUrl(request.url).newBuilder().setQueryParameter("crt", clearance).build();
          const newRequest = { ...request, url: newUrl.toString() };

          const response = await chain.proceed(newRequest);

          if (![400, 403].includes(response.code)) return response;
          this._clearance = null;
          throw new Error("Open webview to refresh token");
        })
        .rateLimit(3),
    ));
  }

  protected popularMangaRequest(page: number): Request {
    const url = toHttpUrl(this.bookApiUrl).newBuilder();
    url.addQueryParameter("sort", "8");
    url.addQueryParameter("page", String(page));

    const tags = this.getTagsPreference();
    const terms: string[] = [];
    if (this.lang !== "all") terms.push(`language:"^${this.siteLang}"`);
    if (tags.trim() !== "") terms.push(tags);

    if (terms.length > 0) url.addQueryParameter("s", terms.join(" "));
    return GET(url.build().toString(), this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const data = response.parseAs<Entries>();
    return new MangasPage(
      data.entries.map(entryToSManga),
      data.limit * data.page < data.total,
    );
  }

  protected latestUpdatesRequest(page: number): Request {
    const url = toHttpUrl(this.bookApiUrl).newBuilder();
    url.addQueryParameter("page", String(page));

    const tags = this.getTagsPreference();
    const terms: string[] = [];
    if (this.lang !== "all") terms.push(`language:"^${this.siteLang}"`);
    if (tags.trim() !== "") terms.push(tags);

    if (terms.length > 0) url.addQueryParameter("s", terms.join(" "));
    return GET(url.build().toString(), this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const url = toHttpUrl(this.bookApiUrl).newBuilder();
    const terms: string[] = [query.trim()];

    if (this.lang !== "all") terms.push(`language:"^${this.siteLang}$"`);
    for (const filter of filters) {
      if (filter instanceof SelectFilter) {
        const value = filter.selected;
        if (value === "popular") url.addPathSegment(value);
        else url.addQueryParameter("sort", value);
      } else if (filter instanceof CategoryFilter) {
        const activeFilter = filter.state.filter((it) => it.state);
        if (activeFilter.length > 0) url.addQueryParameter("cat", String(activeFilter.reduce((sum, it) => sum + it.value, 0)));
      } else if (filter instanceof TextFilter) {
        if (filter.state.length > 0) {
          const tags = filter.state
            .split(",")
            .filter((it) => it.trim() !== "")
            .join(",");
          if (tags.trim() !== "") terms.push(`${filter.type}:${filter.type === "pages" ? tags : `"${tags}"`}`);
        }
      } else if (filter instanceof TagType) {
        if (filter.state > 0) {
          url.addQueryParameter(filter.type, filter.type === "i" && filter.state === 0 ? "" : filter.type === "e" && filter.state === 0 ? "1" : "");
        }
      }
    }
    if (query.length > 0) terms.push(`title:"${query}"`);
    if (terms.length > 0) url.addQueryParameter("s", terms.join(" "));
    url.addQueryParameter("page", String(page));

    return GET(url.build().toString(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  private async getImagesByMangaData(entry: MangaData, entryId: string, entryKey: string): Promise<[ImagesInfo, string]> {
    const data = entry.data;
    const getIPK = (ori?: DataKey | null, alt1?: DataKey | null, alt2?: DataKey | null, alt3?: DataKey | null, alt4?: DataKey | null): [number | null | undefined, string | null | undefined] => [
      ori?.id ?? alt1?.id ?? alt2?.id ?? alt3?.id ?? alt4?.id,
      ori?.key ?? alt1?.key ?? alt2?.key ?? alt3?.key ?? alt4?.key,
    ];
    let ipk: [number | null | undefined, string | null | undefined];
    switch (this.quality()) {
      case "1600":
        ipk = getIPK(data["1600"], data["1280"], data["0"], data["980"], data["780"]);
        break;
      case "1280":
        ipk = getIPK(data["1280"], data["1600"], data["0"], data["980"], data["780"]);
        break;
      case "980":
        ipk = getIPK(data["980"], data["1280"], data["0"], data["1600"], data["780"]);
        break;
      case "780":
        ipk = getIPK(data["780"], data["980"], data["0"], data["1280"], data["1600"]);
        break;
      default:
        ipk = getIPK(data["0"], data["1600"], data["1280"], data["980"], data["780"]);
    }
    const [id, public_key] = ipk;

    if (id == null || public_key == null) throw new Error("No Images Found");

    const realQuality =
      id === data["1600"]?.id ? "1600" : id === data["1280"]?.id ? "1280" : id === data["980"]?.id ? "980" : id === data["780"]?.id ? "780" : "0";

    const imagesResponse = await this.clearanceClient.execute(GET(`${this.bookApiUrl}/data/${entryId}/${entryKey}/${id}/${public_key}/${realQuality}`, this.headers));
    return [imagesResponse.parseAs<ImagesInfo>(), realQuality];
  }

  private shortenTitle = (s: string) => s.replace(shortenTitleRegex, "").trim();

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(`${this.bookApiUrl}/detail/${manga.url}`, this.headers);
  }
  protected mangaDetailsParse(response: Response): SManga {
    const mangaDetail = response.parseAs<MangaDetail>();
    const manga = mangaDetailToSManga(mangaDetail);
    manga.url = urlWithoutDomain(`${mangaDetail.id}/${mangaDetail.key}`);
    manga.title = this.remadd() ? (mangaDetail.title_short ?? this.shortenTitle(mangaDetail.title)) : mangaDetail.title;
    return manga;
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/g/${manga.url}`;
  }
  protected override chapterListRequest(manga: SManga): Request {
    return GET(`${this.bookApiUrl}/detail/${manga.url}`, this.headers);
  }
  protected chapterListParse(response: Response): SChapter[] {
    const manga = response.parseAs<MangaDetail>();
    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.url = `${manga.id}/${manga.key}`;
    chapter.date_upload = manga.updated_at ?? manga.created_at ?? 0;
    return [chapter];
  }

  protected override pageListRequest(chapter: SChapter): Request {
    return POST(`${this.bookApiUrl}/detail/${chapter.url}`, this.headers);
  }
  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse(await this.clearanceClient.execute(await this.pageListRequest(chapter), true));
  }
  protected async pageListParse(response: Response): Promise<Page[]> {
    const mangaData = response.parseAs<MangaData>();
    const matches = /\/detail\/(\d+)\/([a-z\d]+)/.exec(response.url);
    if (matches == null) return [];
    const imagesInfo = await this.getImagesByMangaData(mangaData, matches[1], matches[2]);

    return imagesInfo[0].entries.map((image, index) => new Page(index, "", `${imagesInfo[0].base}/${image.path}?w=${imagesInfo[1]}`));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  // Settings
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const res = new ListPreference(screen.context);
    res.key = PREF_IMAGE_RES;
    res.title = "Image Resolution";
    res.entries = ["780x", "980x", "1280x", "1600x", "Original"];
    res.entryValues = ["780", "980", "1280", "1600", "0"];
    res.summary = "%s";
    res.setDefaultValue("1280");
    screen.addPreference(res);

    const remAdd = new SwitchPreferenceCompat(screen.context);
    remAdd.key = PREF_REM_ADD;
    remAdd.title = "Remove additional information in title";
    remAdd.summary = "Remove anything in brackets from manga titles.\nReload manga to apply changes to loaded manga.";
    remAdd.setDefaultValue(false);
    screen.addPreference(remAdd);

    const include = new EditTextPreference(screen.context);
    include.key = PREF_INCLUDE_TAGS;
    include.title = "Tags to include from browse/search";
    include.summary = `Separate tags with commas (,).\nExcluding: ${this.alwaysIncludeTags()}`;
    screen.addPreference(include);

    const exclude = new EditTextPreference(screen.context);
    exclude.key = PREF_EXCLUDE_TAGS;
    exclude.title = "Tags to exclude from browse/search";
    exclude.summary =
      "Separate tags with commas (,). Supports tag types (females, male, etc), defaults to 'tag' if not specified.\n" +
      "Example: 'ai generated, female:hairy, male:hairy'\n" +
      `Excluding: ${this.alwaysExcludeTags()}`;
    screen.addPreference(exclude);
  }
}
