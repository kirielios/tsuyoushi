// Port of keiyoushi/extensions-source src/all/akuma/Akuma.kt
import {
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  DateTimeFormatter,
  Locale,
  SwitchPreferenceCompat,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type FilterList,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { DDosGuardInterceptor } from "./DDosGuardInterceptor.ts";
import { CategoryFilter, OptionFilter, TextFilter, getFilters } from "./filters.ts";

const PREF_TITLE = "pref_title";

export default class Akuma extends KeiSource {
  private get akumaLang(): string {
    switch (this.lang) {
      case "all":
        return "all";
      case "en":
        return "english";
      case "id":
        return "indonesian";
      case "jv":
        return "javanese";
      case "ca":
        return "catalan";
      case "ceb":
        return "cebuano";
      case "cs":
        return "czech";
      case "da":
        return "danish";
      case "de":
        return "german";
      case "et":
        return "estonian";
      case "es":
        return "spanish";
      case "eo":
        return "esperanto";
      case "fr":
        return "french";
      case "it":
        return "italian";
      case "hi":
        return "hindi";
      case "hu":
        return "hungarian";
      case "nl":
        return "dutch";
      case "pl":
        return "polish";
      case "pt":
        return "portuguese";
      case "vi":
        return "vietnamese";
      case "tr":
        return "turkish";
      case "ru":
        return "russian";
      case "uk":
        return "ukrainian";
      case "ar":
        return "arabic";
      case "ko":
        return "korean";
      case "zh":
        return "chinese";
      case "ja":
        return "japanese";
      default:
        return this.lang;
    }
  }

  override get supportsLatest() {
    return false;
  }

  private nextHash: string | null = null;

  private storedToken: string | null = null;

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm", Locale.ENGLISH);

  protected override configureClient(builder: ClientBuilder) {
    return builder
      .addChainInterceptor(DDosGuardInterceptor(() => this.client.cookieJar, this.host.userAgent))
      .addChainInterceptor(async (chain) => {
        const request = chain.request();

        if (request.method === "POST" && request.headers.get("X-CSRF-TOKEN") == null) {
          const modifiedHeaders = new Headers(request.headers);
          modifiedHeaders.append("X-Requested-With", "XMLHttpRequest");
          const withToken = (token: string): Request => {
            // ponytail: upstream's shared Request.Builder would send the stale and the new token together on the retry; set() sends only the fresh one
            modifiedHeaders.set("X-CSRF-TOKEN", token);
            return { ...request, headers: new Headers(modifiedHeaders) };
          };

          const token = await this.getToken();
          const response = await chain.proceed(withToken(token));

          if (!response.isSuccessful && response.code === 419) {
            this.storedToken = null; // reset the token
            const newToken = await this.getToken();
            return chain.proceed(withToken(newToken));
          }

          return response;
        }

        return chain.proceed(request);
      })
      .rateLimit(2);
  }

  private async getToken(): Promise<string> {
    if (this.storedToken == null || this.storedToken.length === 0) {
      const response = await this.client.execute({ url: this.baseUrl, method: "GET", headers: this.headers });

      const document = response.asJsoup();
      const token = document.select("head meta[name*=csrf-token]").attr("content");

      if (token.length === 0) {
        throw new Error("Unable to find CSRF token");
      }

      this.storedToken = token;
    }

    return this.storedToken;
  }

  private get displayFullTitle(): boolean {
    return this.preferences.getBoolean(PREF_TITLE, false);
  }

  private static readonly shortenTitleRegex = /(\[[^\]]*]|[({][^)}]*[)}])/g;
  private shortenTitle(s: string) {
    return s.replace(Akuma.shortenTitleRegex, "").trim();
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const pref = new SwitchPreferenceCompat(screen.context);
    pref.key = PREF_TITLE;
    pref.title = "Display manga title as full title";
    pref.setDefaultValue(false);
    screen.addPreference(pref);
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", []);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname) return null;
    const id = url.pathname.slice(1).split("/")[1];
    if (id === undefined) return null;
    const manga = SManga.create();
    manga.url = `/g/${id}`;
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const finalQuery: string[] = [query];

    if (this.lang !== "all") {
      finalQuery.push(`language:${this.akumaLang}$`);
    }
    for (const filter of filters) {
      if (filter instanceof TextFilter) {
        if (filter.state.length > 0) {
          finalQuery.push(
            ...filter.state
              .split(",")
              .filter((it) => it.trim() !== "")
              .map((it) => (it.trim().startsWith("-") ? "-" : "") + `${filter.tag}:"${it.trim().replaceAll("-", "")}"`),
          );
        }
      } else if (filter instanceof OptionFilter) {
        if (filter.state > 0) finalQuery.push(`opt:${filter.getValue()}`);
      } else if (filter instanceof CategoryFilter) {
        for (const it of filter.state) {
          if (it.isIncluded()) finalQuery.push(`category:"${it.name}"`);
          else if (it.isExcluded()) finalQuery.push(`-category:"${it.name}"`);
        }
      }
    }

    const url = toHttpUrl(this.baseUrl).newBuilder();
    if (page === 1) {
      this.nextHash = null;
    } else {
      url.addQueryParameter("cursor", this.nextHash);
    }

    url.setQueryParameter("q", finalQuery.join(" "));

    const payload = new URLSearchParams({ view: "3" });

    return this.parseSearch(await this.client.post(url.build().toString(), undefined, payload));
  }

  private parseSearch(response: Response): MangasPage {
    const document = response.asJsoup();

    if (document.text().includes("Max keywords of 3 exceeded.")) {
      throw new Error("Login required for more than 3 filters");
    } else if (document.text().includes("Max keywords of 8 exceeded.")) {
      throw new Error("Only max of 8 filters are allowed");
    }

    const mangas = document.select(".post-loop li").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.select("a").attr("href"));
      const title = element.select(".overlay-title").text().replaceAll('"', "");
      manga.title = this.displayFullTitle ? title : this.shortenTitle(title);
      manga.thumbnail_url = element.select("img").attr("abs:src");
      return manga;
    });

    const nextUrl = document.select(".page-item a[rel*=next]").first()?.attr("href");

    this.nextHash = nextUrl ? toHttpUrl(nextUrl).queryParameter("cursor") : null;

    return new MangasPage(mangas, this.nextHash != null && this.nextHash.length > 0);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(doc), this.chapterListParse(doc));
  }

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(document.location());
    const title = document.select(".entry-title").text().replaceAll('"', "");
    manga.title = this.displayFullTitle ? title : this.shortenTitle(title);
    manga.thumbnail_url = document.select(".img-thumbnail").attr("abs:src");

    manga.author = document.select(".group~.value").eachText().join(", ");
    manga.artist = document.select(".artist~.value").eachText().join(", ");

    const characters = document.select(".character~.value").eachText();
    const parodies = document.select(".parody~.value").eachText();
    const males = document.select(".male~.value").map((it) => `${it.text()} ♂`);
    const females = document.select(".female~.value").map((it) => `${it.text()} ♀`);
    const others = document.select(".other~.value").map((it) => `${it.text()} ◊`);

    manga.genre = [...males, ...females, ...others].join(", ");
    let description = "";
    description += ["Full English and Japanese title: \n", document.select(".entry-title").text(), "\n", document.select(".entry-title+span").text(), "\n\n"].join("");

    description += ["Language: ", document.select(".language~.value").eachText().join(", "), "\n"].join("");
    description += ["Pages: ", document.select(".pages .value").text(), "\n"].join("");
    description += ["Upload Date: ", document.select(".date .value>time").text().replaceAll(" ", ", ") + " UTC", "\n"].join("");
    description += ["Categories: ", document.selectFirst(".info-list .value")?.text() ?? "Unknown", "\n\n"].join("");

    if (parodies.length > 0) description += ["Parodies: ", parodies.join(", "), "\n"].join("");
    if (characters.length > 0) description += ["Characters: ", characters.join(", "), "\n"].join("");
    manga.description = description;
    // ponytail: update_strategy = ONLY_FETCH_ONCE has no SManga field in the SDK
    manga.status = SManga.UNKNOWN;
    return manga;
  }

  private chapterListParse(document: Document): SChapter[] {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(`${document.location()}/1`);
    chapter.name = "Chapter";
    chapter.date_upload = this.dateFormat.tryParseDate(document.select(".date .value>time").text());
    return [chapter];
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const value = document.select(".nav-select option").last()?.attr("value");
    const totalPages = value !== undefined && /^[+-]?\d+$/.test(value) ? Number.parseInt(value, 10) : null;
    if (totalPages == null) return [];

    const url = substringBeforeLast(document.location(), "/");

    return Array.from({ length: Math.max(totalPages, 0) }, (_, k) => k + 1).map((i) => (i === 1 ? new Page(i, "", document.select(".entry-content img").attr("abs:src")) : new Page(i, `${url}/${i}`)));
  }

  override async getImageUrl(page: Page): Promise<string> {
    return (await this.client.get(page.url)).asJsoup().select(".entry-content img").attr("abs:src");
  }

  override getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }
}
