// Port of keiyoushi/extensions-source src/all/mango/Mango.kt
import { EditTextPreference, FilterList, KeiSource, MangasPage, POST, Page, SChapter, SManga, SMangaUpdate, type Chain, type ClientBuilder, type PreferenceScreen, type Response } from "../../../sdk/index.ts";
import type { LibraryDto, TitleDto } from "./dto.ts";
import { jaroWinklerDistance, levenshteinDistance } from "./similarity.ts";

const ADDRESS_TITLE = "Address";
const PORT_TITLE = "Server Port Number";
const PORT_DEFAULT = "9000";
const USERNAME_TITLE = "Username";
const USERNAME_DEFAULT = "admin";
const PASSWORD_TITLE = "Password";
const PASSWORD_DEFAULT = "";

export default class Mango extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  // ============================== Popular ==============================
  // Our popular manga are just our library of manga
  async getPopularManga(_page: number): Promise<MangasPage> {
    const result = this.parseOrLoginError<LibraryDto>(await this.client.get(`${this.apiUrl}/library?depth=0`));
    const mangas = result.titles;
    if (mangas == null) return new MangasPage([], false);

    return new MangasPage(
      mangas.map((it) => this.toSManga(it)),
      false,
    );
  }

  private toSManga(dto: TitleDto): SManga {
    const manga = SManga.create();
    manga.url = `/book/${dto.id}`;
    manga.title = dto.display_name;
    manga.thumbnail_url = this.basePath + dto.cover_url;
    return manga;
  }

  // ============================== Latest ===============================
  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ===============================
  // Default is to just return the whole library for searching
  // Here the best we can do is just match manga based on their titles
  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const queryLower = query.toLowerCase();
    const mangas = (await this.getPopularManga(1)).mangas;
    const exactMatch = mangas.find((it) => it.title.toLowerCase() === queryLower);
    if (exactMatch != null) return new MangasPage([exactMatch], false);

    // Take results that potentially start the same
    const query2 = queryLower.slice(0, 7);
    const results = mangas
      .filter((it) => {
        const title = it.title.toLowerCase();
        return title.startsWith(query2) || title.includes(query2);
      })
      .map((it) => [levenshteinDistance(queryLower, it.title.toLowerCase()), it] as const)
      .sort((a, b) => a[0] - b[0])
      .map((it) => it[1]);

    // Take similar results
    const results2 = mangas
      .map((it) => [jaroWinklerDistance(it.title.toLowerCase(), queryLower), it] as const)
      .filter((it) => it[0] < 0.3)
      .sort((a, b) => a[0] - b[0])
      .map((it) => it[1]);

    // results.union(results2): insertion-ordered set of the same instances
    const combinedResults = [...new Set([...results, ...results2])];

    return new MangasPage(combinedResults, false);
  }

  // ============================== Details ==============================
  // The chapter url will contain how many pages the chapter contains for our page list endpoint
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const result = this.parseOrLoginError<TitleDto>(await this.client.get(`${this.apiUrl}${manga.url}?sort=auto`));
    return new SMangaUpdate(this.toSManga(result), this.listChapters(result));
  }

  // ============================= Chapters ==============================
  // Helper function for listing chapters and chapters in nested titles recursively
  private listChapters(titleObj: TitleDto): SChapter[] {
    const chapters: SChapter[] = [];
    const topChapters = titleObj.entries?.map((it) => {
      const chapter = SChapter.create();
      chapter.name = it.display_name;
      chapter.url = `/page/${it.title_id}/${it.id}/${it.pages}/`;
      chapter.date_upload = 1000 * it.mtime;
      return chapter;
    });
    const subChapters = titleObj.titles?.flatMap((it) => {
      const name = it.display_name;
      return this.listChapters(it).map((chp) => {
        chp.name = `${name} / ${chp.name}`;
        return chp;
      });
    });
    if (topChapters != null) chapters.push(...topChapters);
    if (subChapters != null) chapters.push(...subChapters);
    return chapters;
  }

  // =============================== Pages ===============================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const splitUrl = chapter.url.split("/");
    const numPages = Number.parseInt(splitUrl.splice(splitUrl.length - 2, 1)[0], 10);
    const baseUrlChapter = splitUrl.join("/");
    return Array.from({ length: numPages }, (_, k) => new Page(k + 1, "", `${this.apiUrl}${baseUrlChapter}${k + 1}`));
  }

  // ============================= Utilities =============================
  private apiCookies = "";
  /** Which settings the cookie was issued for: upstream clears apiCookies from the preference change listener, which the app does not run. */
  private loginKey = "";

  private parseOrLoginError<T>(response: Response): T {
    try {
      return response.parseAs<T>();
    } catch {
      this.apiCookies = "";
      throw new Error("Login Likely Failed. Try Refreshing.");
    }
  }

  private get port(): string {
    return this.preferences.getString(PORT_TITLE, PORT_DEFAULT)!;
  }
  private get username(): string {
    return this.preferences.getString(USERNAME_TITLE, USERNAME_DEFAULT)!;
  }
  private get password(): string {
    return this.preferences.getString(PASSWORD_TITLE, PASSWORD_DEFAULT)!;
  }

  private migratePreferencesIfNeeded() {
    const oldUrl = this.preferences.getString(ADDRESS_TITLE, null);
    if (oldUrl != null) {
      // upstream's "pref_custom_base_url_$id" is the generated custom-URL preference: overrideBaseUrl here
      this.preferences.edit().putString("overrideBaseUrl", oldUrl).remove(ADDRESS_TITLE).apply();
    }
  }

  private get basePath(): string {
    this.migratePreferencesIfNeeded();
    return this.baseUrl.replace(/\/$/, "");
  }

  private get apiUrl(): string {
    return `${this.basePath}/api`;
  }

  protected override configureHeaders(headers: Headers): Headers {
    // AppInfo.getVersionName() has no counterpart here
    headers.set("User-Agent", "Tachiyomi Mango v0.1.0");
    return headers;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor((chain) => this.authIntercept(chain));
  }

  private async authIntercept(chain: Chain): Promise<Response> {
    const request = chain.request();
    if (this.username.length === 0 || this.password.length === 0) throw new Error("Missing username or password");

    // Do the login if we have not gotten the cookies yet
    const key = `${this.basePath}|${this.port}|${this.username}|${this.password}`;
    if (this.apiCookies.length === 0 || !this.apiCookies.toLowerCase().includes(`mango-sessid-${this.port}`.toLowerCase()) || key !== this.loginKey) {
      await this.doLogin(chain);
      this.loginKey = key;
    }

    // Append the new cookie from the api
    const headers = new Headers(request.headers);
    headers.set("Cookie", this.apiCookies);
    return chain.proceed({ ...request, headers });
  }

  private async doLogin(chain: Chain) {
    const formBody = new URLSearchParams({ username: this.username, password: this.password });

    const loginRequest = POST(`${this.basePath}/login`, this.headers, formBody);
    const response = await chain.proceed(loginRequest);

    const cookie = response.header("Set-Cookie");
    if (!response.isSuccessful || cookie == null) throw new Error("Login Failed. Check Address and Credentials");
    this.apiCookies = cookie;
  }

  // ============================== Settings =============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    screen.addPreference(this.editTextPreference(PORT_TITLE, PORT_DEFAULT, "The port number to use if it's not the default 9000"));
    screen.addPreference(this.editTextPreference(USERNAME_TITLE, USERNAME_DEFAULT, "Your login username"));
    // isPassword (setOnBindEditTextListener) has no counterpart in the SDK's text preference
    screen.addPreference(this.editTextPreference(PASSWORD_TITLE, PASSWORD_DEFAULT, "Your login password", true));
  }

  private editTextPreference(title: string, def: string, summary: string, _isPassword = false): EditTextPreference {
    const pref = new EditTextPreference();
    pref.key = title;
    pref.title = title;
    const input = this.preferences.getString(title, null);
    pref.summary = input == null || input.length === 0 ? summary : input;
    pref.setDefaultValue(def);
    pref.dialogTitle = title;
    return pref;
  }
}
