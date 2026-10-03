// Port of keiyoushi/extensions-source src/all/honeytoon/Honeytoon.kt (+ ScrambledImageInterceptor.kt)
import { Intl } from "../../../libs/i18n/index.ts";
import {
  Canvas,
  DateTimeFormatter,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  POST,
  Page,
  Response,
  SChapter,
  SManga,
  SwitchPreferenceCompat,
  imageSize,
  parseHtml,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type ChainInterceptor,
  type ClientBuilder,
  type Element,
  type FilterList,
  type PreferenceScreen,
  type Request,
} from "../../../sdk/index.ts";
import { messages } from "./messages.ts";

const PREF_ADULT_KEY = "prefAdultKey";

interface SearchDto {
  title: string;
  image: string;
  link: string;
}

export default class Honeytoon extends HttpSource {
  private get siteLangPath(): string {
    return this.lang === "pt-BR" ? "pt" : this.lang;
  }

  override get supportsLatest(): boolean {
    return true;
  }

  private get isAdultContentEnabled(): boolean {
    return this.preferences.getBoolean(PREF_ADULT_KEY, false);
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addInterceptor((request) => this.addCookie(request, [["eighteen", this.isAdultContentEnabled ? "1" : "0"]]))
      .addChainInterceptor(async (chain) => {
        const fragment = new URL(chain.request().url).hash.replace(/^#/, "");
        if (fragment && fragment.includes("locked")) throw new Error(this.intl.get("chapter_locked_warning"));
        return chain.proceed(chain.request());
      })
      .addChainInterceptor(this.scrambledImageInterceptor())
      .rateLimit(3, 1000);
  }

  /** keiyoushi's addCookie(cookies): (re)set in the jar for the base host on every matching request, which then sends them. */
  private addCookie(request: Request, cookies: [string, string][]): Request {
    const d = toHttpUrl(this.baseUrl).host;
    const host = new URL(request.url).hostname;
    if (host === d || host.endsWith(`.${d}`)) {
      for (const [key, value] of cookies) this.client.cookieJar.set(`https://${d}/`, `${key}=${value}; Domain=${d}; Path=/`);
    }
    return request;
  }

  private _intl?: Intl;
  private get intl(): Intl {
    return (this._intl ??= new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "pt-BR"], messages }));
  }

  // ScrambledImageInterceptor.kt
  private scrambledImageInterceptor(): ChainInterceptor {
    return async (chain) => {
      const response = await chain.proceed(chain.request());
      const mime = response.header("Content-Type");

      if (mime !== "application/octet-stream") return response;

      const xPartSizes = response.header("X-Part-Sizes");
      if (xPartSizes == null) return response;
      const sizes = xPartSizes.split(",").map((it) => Number.parseInt(it.trim(), 10));

      const parts = await this.decodeImages(response.bytes(), sizes);
      const width = Math.max(...parts.map((it) => it.width));
      const height = parts.reduce((sum, it) => sum + it.height, 0);

      const canvas = new Canvas(this.host, width, height);
      let currentHeight = 0;
      for (const p of parts) {
        canvas.drawImage(p.bytes, 0, 0, p.width, p.height, 0, currentHeight);
        currentHeight += p.height;
      }

      return Response.of(response.url, await canvas.encode("webp", 100), "image/webp", response.code);
    };
  }

  private async decodeImages(data: Uint8Array, sizes: number[]) {
    const bitmaps: { bytes: Uint8Array; width: number; height: number }[] = [];
    let offset = 0;

    for (const size of sizes) {
      const part = data.slice(offset, offset + size);
      // BitmapFactory.decodeByteArray returns null for undecodable bytes: the part is skipped
      const dims = await imageSize(this.host, part).catch(() => null);
      if (dims != null) bitmaps.push({ bytes: part, ...dims });
      offset += size;
    }
    return bitmaps;
  }

  // Popular

  protected override popularMangaRequest(_page: number): Request {
    const langPath = this.lang === "en" ? "" : `/${this.siteLangPath}`;
    return GET(`${this.baseUrl}${langPath}/ranking`, this.headers);
  }

  protected override popularMangaParse(response: Response): MangasPage {
    return this.mangaParse(response, ".section.popular");
  }

  // Latest

  protected override latestUpdatesRequest(page: number): Request {
    return this.popularMangaRequest(page);
  }

  protected override latestUpdatesParse(response: Response): MangasPage {
    return this.mangaParse(response, ".section.new");
  }

  // Search

  // upstream overrides fetchSearchManga: a pasted URL opens that comic (the "deeplink" fragment asks for its cover and url)
  override async getSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrlOrNull(query);
    if (url != null) {
      // the fetch drops the fragment from the response URL, so the deeplink flag is passed explicitly
      const response = await this.client.execute(GET(url.newBuilder().fragment("deeplink").build().toString(), this.headers));
      return new MangasPage([this.mangaDetailsParse(response, true)], false);
    }
    return this.fetchSearchManga(page, query, filters);
  }

  protected override searchMangaRequest(_page: number, query: string, _filters: FilterList): Request {
    const langPath = this.lang === "en" ? "" : `/${this.siteLangPath}`;
    const form = new URLSearchParams();
    form.append("query", query);
    return POST(`${this.baseUrl}${langPath}/api/comic/search`, this.headers, form);
  }

  protected override searchMangaParse(response: Response): MangasPage {
    const mangas = response.parseAs<SearchDto[]>().map((it) => {
      const manga = SManga.create();
      manga.title = parseHtml(this.host.load, it.title, "").selectFirst("body")!.ownText();
      manga.thumbnail_url = `https://pic.honeytoon.com/${it.image}`;
      manga.url = it.link;
      return manga;
    });

    return new MangasPage(mangas, false);
  }

  // Details

  protected override mangaDetailsParse(response: Response, deeplink = false): SManga {
    const manga = SManga.create();
    const document = response.asJsoup();
    manga.title = document.selectFirst("h1")!.text();

    manga.author = document.select(".comic-book__story-art a").map((it) => it.text()).join(", ");
    manga.description = document.selectFirst(".comic-book__desc")?.text();
    manga.genre = document.select(".comic-book-content a[href*=genre], .comic-tag").map((it) => it.text()).join(", ");
    if (document.selectFirst(".comic-book-content .label__item--complete") != null) manga.status = SManga.COMPLETED;
    else if (document.selectFirst(".comic-book-content .label__item--dayofpublication") != null) manga.status = SManga.ONGOING;
    else manga.status = SManga.UNKNOWN;

    // The manga page has really large cover images,
    // so I'm prioritizing covers from the 'popular', 'latest' and 'search'.
    if (deeplink) {
      manga.thumbnail_url = document.selectFirst(".comic-book-img img")?.absUrl("src");
      manga.url = urlWithoutDomain(document.location());
    }
    return manga;
  }

  // Chapters

  protected override chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    return document
      .select(".comic-list-items > a")
      .map((element, index) => {
        const isLocked = element.selectFirst(".lock-ico, .token-ico") != null;
        const chapter = SChapter.create();
        chapter.name = element.selectFirst(".comic-list__title-desc")!.text() + (isLocked ? " 🔒" : "");

        chapter.date_upload = this.dateFormat.tryParseDate(element.selectFirst(".comic-list__title-date")?.text());
        chapter.url = urlWithoutDomain((!isLocked ? element.absUrl("href") : "") || `${document.location()}/${index}#locked`);
        return chapter;
      })
      .reverse();
  }

  // Pages

  protected override pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    return document.select(".single__item img, .comic-canvas-scramble").map((element, index) => {
      if (element.tagName() === "img") return new Page(index, "", this.imgSrc(element));
      return new Page(index, "", `${this.baseUrl}/api/common/resource/sync?t=${element.attr("data-token")}`);
    });
  }

  private imgSrc(el: Element): string {
    return el.hasAttr("data-src") ? el.absUrl("data-src") : el.absUrl("src");
  }

  protected override pageListRequest(chapter: SChapter): Request {
    const parts = chapter.url.split("/").filter((it) => it.trim().length > 0);
    parts.pop();
    const slug = parts[parts.length - 1];
    return GET(`${this.baseUrl}${chapter.url}#slug=${slug}`, this.headers);
  }

  protected override imageUrlParse(_response: Response): string {
    return "";
  }

  // Settings

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = PREF_ADULT_KEY;
    p.title = this.intl.get("switch_adult_title");
    p.summary = this.intl.get("switch_adult_summary");
    p.setDefaultValue(false);
    // setOnPreferenceChangeListener { Toast(switch_adult_toast) }: the reader has no toast hook, the setting applies on the next request
    screen.addPreference(p);
  }

  // Utils
  private mangaParse(response: Response, cssSelector: string): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(`${cssSelector} .preview-card__link`).map((element) => {
      const manga = SManga.create();
      manga.title = element.selectFirst(".preview-card__title")!.text();
      manga.thumbnail_url = element.selectFirst(".preview-card__image")?.absUrl("src");
      manga.url = urlWithoutDomain(element.absUrl("href"));
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  private get dateFormat(): DateTimeFormatter {
    const [language, country] = this.lang.includes("-") ? this.lang.split("-") : [this.lang, undefined];
    return DateTimeFormatter.ofPattern("MMMM dd , yyyy", new Locale(language, country));
  }
}
