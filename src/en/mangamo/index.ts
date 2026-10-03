// Port of keiyoushi/extensions-source src/en/mangamo/Mangamo.kt
import {
  EditTextPreference,
  KeiSource,
  MangasPage,
  MultiSelectListPreference,
  Page,
  PreferenceScreen,
  SChapter,
  SManga,
  SMangaUpdate,
  type ClientBuilder,
  type FilterList,
  type Response,
} from "../../../sdk/index.ts";
import { MangamoAuth } from "./auth.ts";
import { MangamoConstants } from "./constants.ts";
import { documents, elements, isVolume, parseDocument, parseQueryResult, type ChapterDto, type PageDto, type SeriesDto, type UserDto } from "./dto.ts";
import { FirestoreRequestFactory } from "./firestore.ts";
import { MangamoHelper } from "./helper.ts";

export default class Mangamo extends KeiSource {
  private readonly helper = new MangamoHelper(() => this.headers);

  // private var userToken (lazy: pref, else a fresh anonymous Firebase user stored in the pref)
  private async getUserToken(): Promise<string> {
    let field = this.preferences.getString(MangamoConstants.USER_TOKEN_PREF, "") ?? "";
    if (field === "") {
      field = await MangamoAuth.createAnonymousUserToken(this.client);
      this.preferences.edit().putString(MangamoConstants.USER_TOKEN_PREF, field).apply();
    }
    return field;
  }

  // by cachedBy({ userToken }) / cachedBy({ auth })
  private cachedAuth?: { token: string; auth: MangamoAuth; firestore: FirestoreRequestFactory };
  private async getFirestore(): Promise<{ auth: MangamoAuth; firestore: FirestoreRequestFactory }> {
    const token = await this.getUserToken();
    if (this.cachedAuth?.token !== token) {
      const auth = new MangamoAuth(this.helper, this.client, token);
      this.cachedAuth = { token, auth, firestore: new FirestoreRequestFactory(this.helper, auth) };
    }
    return this.cachedAuth;
  }

  private async getUser(): Promise<UserDto> {
    const { firestore } = await this.getFirestore();
    const request = await firestore.getDocument(`Users/${await this.getUserToken()}`, (q) => {
      q.fields = ["isSubscribed"];
    });
    const response = await this.client.get(request.url, request.headers);
    return parseDocument<UserDto>(response.text()).fields;
  }

  private get coinMangaPref(): string[] {
    return this.preferences.getStringSet(MangamoConstants.HIDE_COIN_MANGA_PREF, []);
  }
  private get exclusivesOnlyPref(): string[] {
    return this.preferences.getStringSet(MangamoConstants.EXCLUSIVES_ONLY_PREF, []);
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    // The second network interceptor only adds Cache-Control to Firestore responses for OkHttp's cache; the SDK has none.
    return builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      const response = await chain.proceed(request);

      if (request.url.startsWith(`${MangamoConstants.FIREBASE_FUNCTION_BASE_PATH}/page`)) {
        if (response.code === 401) {
          throw new Error("You don't have access to this chapter");
        }
      }
      return response;
    });
  }

  private readonly seriesRequiredFields = ["id", "name", "name_lowercase", "description", "authors", "genres", "ongoing", "releaseStatusTag", "titleArt"];

  private processSeries(dto: SeriesDto): SManga {
    const manga = SManga.create();
    manga.author = dto.authors?.map((it) => it.name).join(", ");
    manga.description = dto.description;
    manga.genre = dto.genres?.map((it) => it.name).join(", ");
    manga.status = this.helper.getSeriesStatus(dto);
    manga.thumbnail_url = dto.titleArt;
    manga.title = dto.name!;
    manga.url = this.helper.getSeriesUrl(dto);
    manga.initialized = true;
    return manga;
  }

  private parseMangaPage(response: Response, filterPredicate: (s: SeriesDto) => boolean = () => true): MangasPage {
    const collection = parseQueryResult<SeriesDto>(response.text());

    const isDone = documents(collection).length < MangamoConstants.BROWSE_PAGE_SIZE;

    const results = elements(collection).filter(filterPredicate);

    return new MangasPage(
      results.map((it) => this.processSeries(it)),
      !isDone,
    );
  }

  // Popular manga

  async getPopularManga(page: number): Promise<MangasPage> {
    const { firestore } = await this.getFirestore();
    const request = await firestore.getCollection("Series", (q) => {
      q.limit = MangamoConstants.BROWSE_PAGE_SIZE;
      q.offset = (page - 1) * MangamoConstants.BROWSE_PAGE_SIZE;

      const fields = [...this.seriesRequiredFields];
      q.fields = fields;

      if (this.coinMangaPref.includes(MangamoConstants.HIDE_COIN_MANGA_OPTION_IN_BROWSE)) {
        fields.push("onlyTransactional");
      }

      const prefFilters = this.exclusivesOnlyPref.includes(MangamoConstants.EXCLUSIVES_ONLY_OPTION_IN_BROWSE) ? q.isEqual("onlyOnMangamo", true) : null;

      q.filter = q.and(...[q.isEqual("enabled", true), prefFilters].filter((it) => it !== null));
    });

    const response = await this.client.post(request.url, request.headers, request.body as string);
    return this.parseMangaPage(response, (it) => !(this.coinMangaPref.includes(MangamoConstants.HIDE_COIN_MANGA_OPTION_IN_BROWSE) && it.onlyTransactional === true));
  }

  // Latest manga

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const { firestore } = await this.getFirestore();
    const request = await firestore.getCollection("Series", (q) => {
      q.limit = MangamoConstants.BROWSE_PAGE_SIZE;
      q.offset = (page - 1) * MangamoConstants.BROWSE_PAGE_SIZE;

      const fields = [...this.seriesRequiredFields];
      q.fields = fields;

      fields.push("enabled");

      if (this.coinMangaPref.includes(MangamoConstants.HIDE_COIN_MANGA_OPTION_IN_BROWSE)) {
        fields.push("onlyTransactional");
      }

      if (this.exclusivesOnlyPref.includes(MangamoConstants.EXCLUSIVES_ONLY_OPTION_IN_BROWSE)) {
        fields.push("onlyOnMangamo");
      }

      q.orderBy = [q.descending("updatedAt")];

      // Filters can't be used with orderBy because firebase wants there to be indexes
      // on various fields to support those queries and we can't create them.
      // Therefore, all filtering has to be done on the client in the parse method.
    });

    const response = await this.client.post(request.url, request.headers, request.body as string);
    return this.parseMangaPage(
      response,
      (it) =>
        it.enabled === true &&
        !(this.coinMangaPref.includes(MangamoConstants.HIDE_COIN_MANGA_OPTION_IN_BROWSE) && it.onlyTransactional === true) &&
        !(this.exclusivesOnlyPref.includes(MangamoConstants.EXCLUSIVES_ONLY_OPTION_IN_BROWSE) && it.onlyOnMangamo !== true),
    );
  }

  // Search manga

  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const { firestore } = await this.getFirestore();
    const request = await firestore.getCollection("Series", (q) => {
      q.limit = MangamoConstants.BROWSE_PAGE_SIZE;
      q.offset = (page - 1) * MangamoConstants.BROWSE_PAGE_SIZE;

      const fields = [...this.seriesRequiredFields];
      q.fields = fields;

      if (this.coinMangaPref.includes(MangamoConstants.HIDE_COIN_MANGA_OPTION_IN_BROWSE)) {
        fields.push("onlyTransactional");
      }

      if (this.exclusivesOnlyPref.includes(MangamoConstants.EXCLUSIVES_ONLY_OPTION_IN_SEARCH)) {
        fields.push("onlyOnMangamo");
      }

      // Adding additional filters makes Firestore complain about wanting an index
      // so we filter on the client in parse, just like for Latest.

      q.filter = q.and(q.isEqual("enabled", true), q.isGreaterThanOrEqual("name_lowercase", query.toLowerCase()), q.isLessThanOrEqual("name_lowercase", `${query.toLowerCase()}`));
    });

    const response = await this.client.post(request.url, request.headers, request.body as string);
    return this.parseMangaPage(
      response,
      (it) =>
        !(this.coinMangaPref.includes(MangamoConstants.HIDE_COIN_MANGA_OPTION_IN_SEARCH) && it.onlyTransactional === true) &&
        !(this.exclusivesOnlyPref.includes(MangamoConstants.EXCLUSIVES_ONLY_OPTION_IN_SEARCH) && it.onlyOnMangamo !== true),
    );
  }

  // Manga details

  override getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const uri = new URL(this.getMangaUrl(manga));
    const seriesId = Number.parseInt(uri.searchParams.get(MangamoConstants.SERIES_QUERY_PARAM)!, 10);

    const { firestore } = await this.getFirestore();

    const seriesDeferred = (async (): Promise<SeriesDto | null> => {
      if (fetchDetails || fetchChapters) {
        const request = await firestore.getDocument(`Series/${seriesId}`, (q) => {
          q.fields = [];
          if (fetchDetails) {
            q.fields.push(...this.seriesRequiredFields);
          }
          if (fetchChapters) {
            q.fields.push("maxFreeChapterNumber", "maxMeteredReadingChapterNumber", "onlyTransactional");
          }
        });
        const response = await this.client.get(request.url, request.headers);
        return parseDocument<SeriesDto>(response.text()).fields;
      }
      return null;
    })();
    const chaptersDeferred = (async (): Promise<ChapterDto[] | null> => {
      if (fetchChapters) {
        const request = await firestore.getCollection(`Series/${seriesId}/chapters`, (q) => {
          q.fields = ["alwaysFree", "enabled", "id", "seriesId", "chapterNumber", "name", "createdAt", "onlyTransactional", "type"];

          q.orderBy = [q.descending("chapterNumber")];
        });
        const response = await this.client.post(request.url, request.headers, request.body as string);
        return elements(parseQueryResult<ChapterDto>(response.text()));
      }
      return null;
    })();

    const [series, chapterList] = await Promise.all([seriesDeferred, chaptersDeferred]);
    const hideCoinChapters = this.coinMangaPref.includes(MangamoConstants.HIDE_COIN_MANGA_OPTION_CHAPTERS);

    if (series === null) return new SMangaUpdate(manga, chapters);

    const updatedManga = fetchDetails ? this.processSeries(series) : manga;
    let updatedChapters: SChapter[];
    if (chapterList !== null) {
      const isUserSubscribed = (await this.getUser()).isSubscribed === true;

      updatedChapters = [];
      for (const chapter of chapterList) {
        if (chapter.enabled !== true) continue;

        const chapterNumber = chapter.chapterNumber!;
        const isFreeChapter = chapter.alwaysFree === true || chapterNumber <= (series.maxFreeChapterNumber ?? 0);
        const metered = Number.parseFloat(String(series.maxMeteredReadingChapterNumber));
        const isMeteredChapter = chapterNumber <= (Number.isNaN(metered) ? 0 : metered);
        const isCoinChapter = chapter.onlyTransactional === true || (series.onlyTransactional === true && isVolume(chapter) && !isFreeChapter);

        if (hideCoinChapters && isCoinChapter) continue;

        const sChapter = SChapter.create();
        sChapter.chapter_number = chapterNumber;
        sChapter.date_upload = chapter.createdAt!;
        sChapter.name =
          (chapter.name ?? "null") +
          (isCoinChapter
            ? " 🪙" // coin emoji
            : isFreeChapter || isUserSubscribed
              ? ""
              : isMeteredChapter
                ? " 🕒" // three-o-clock emoji
                : // subscriber chapter
                  " 🔒"); // lock emoji
        sChapter.url = this.helper.getChapterUrl(chapter);
        updatedChapters.push(sChapter);
      }
    } else {
      updatedChapters = chapters;
    }

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const uri = new URL(this.baseUrl + chapter.url);

    const seriesId = Number.parseInt(uri.searchParams.get(MangamoConstants.SERIES_QUERY_PARAM)!, 10);
    const chapterId = Number.parseInt(uri.searchParams.get(MangamoConstants.CHAPTER_QUERY_PARAM)!, 10);
    const { auth } = await this.getFirestore();
    const response = await this.client.post(`${MangamoConstants.FIREBASE_FUNCTION_BASE_PATH}/page/${seriesId}/${chapterId}`, this.helper.jsonHeaders, `{"idToken":"${await auth.getIdToken()}"}`);
    const data = JSON.parse(response.text()) as PageDto[];

    return data.map((it) => new Page(it.pageNumber - 1, "", it.uri)).sort((a, b) => a.index - b.index);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const userTokenPref = new EditTextPreference(screen.context);
    userTokenPref.key = MangamoConstants.USER_TOKEN_PREF;
    userTokenPref.title = "User Token";
    // dialogMessage has no field in the app's preference form, so it is appended to the summary
    userTokenPref.summary =
      "If you are a paying user, enter your user token to authenticate.\n\n" +
      'Copy your token from the Mangamo app by going to My Manga > Profile icon (top right) > About and tapping on the "User" string at the bottom.\n\n' +
      "Then replace the auto-generated token you see below with your personal token.";
    userTokenPref.setDefaultValue("");

    const hideCoinMangaPref = new MultiSelectListPreference(screen.context);
    hideCoinMangaPref.key = MangamoConstants.HIDE_COIN_MANGA_PREF;
    hideCoinMangaPref.title = "Hide Coin Manga";
    hideCoinMangaPref.summary =
      "Hide manga that require coins.\n\n" +
      "For technical reasons, manga where a subscription only gives access to some chapters are not considered coin manga, even if coins are required to access all chapters.";
    hideCoinMangaPref.entries = ["Hide in Popular/Latest", "Hide in Search", "Hide Coin Chapters"];
    hideCoinMangaPref.entryValues = [MangamoConstants.HIDE_COIN_MANGA_OPTION_IN_BROWSE, MangamoConstants.HIDE_COIN_MANGA_OPTION_IN_SEARCH, MangamoConstants.HIDE_COIN_MANGA_OPTION_CHAPTERS];
    hideCoinMangaPref.setDefaultValue([]);

    const exclusivesOnly = new MultiSelectListPreference(screen.context);
    exclusivesOnly.key = MangamoConstants.EXCLUSIVES_ONLY_PREF;
    exclusivesOnly.title = "Only Show Exclusives";
    exclusivesOnly.summary = "Only show Mangamo-exclusive manga.";
    exclusivesOnly.entries = ["In Popular/Latest", "In Search"];
    exclusivesOnly.entryValues = [MangamoConstants.EXCLUSIVES_ONLY_OPTION_IN_BROWSE, MangamoConstants.EXCLUSIVES_ONLY_OPTION_IN_SEARCH];
    exclusivesOnly.setDefaultValue([]);

    screen.addPreference(userTokenPref);
    screen.addPreference(hideCoinMangaPref);
    screen.addPreference(exclusivesOnly);
  }
}
