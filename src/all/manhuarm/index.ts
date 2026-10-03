// Port of keiyoushi/extensions-source src/all/manhuarm/Manhuarm.kt (+ Utils.kt, interceptors/CloudflareWarmupInterceptor.kt)
//
// Not ported: the dialogue overlay. Upstream captures the site's fetch-ocr.php request by running the chapter page's
// scripts in a WebView (OcrUrlInterceptor); site code is never executed here, so no OCR request is found and pages
// come back as plain images - upstream's own path when the WebView captures nothing. TranslationInterceptor and
// ComposedImageInterceptor only act on pages carrying dialogue fragments, so they never run and are left out.
import {
  ClientBuilder,
  EditTextPreference,
  GET,
  HttpClient,
  Intl,
  ListPreference,
  SwitchPreferenceCompat,
  urlWithoutDomain,
  type Document,
  type Element,
  type Page,
  type PreferenceScreen,
  type Request,
  type Response,
  type SChapter,
  SManga,
} from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madaralegacy/index.ts";
import { messages } from "./messages.ts";
import { BingTranslator, GoogleTranslator, type TranslatorEngine } from "./translator.ts";

// Utils.kt
interface Language {
  lang: string;
  target: string;
  origin: string;
  fontSize: number;
  dialogBoxScale: number;
  disableFontSettings: boolean;
  disableWordBreak: boolean;
  disableTranslator: boolean;
  translateSynopsis: boolean;
  supportNativeTranslation: boolean;
  fontName: string;
}
const Language = (lang: string, target = lang, extra: Partial<Language> = {}): Language => ({
  lang,
  target,
  origin: "en",
  fontSize: 28,
  dialogBoxScale: 1,
  disableFontSettings: false,
  disableWordBreak: false,
  disableTranslator: false,
  translateSynopsis: false,
  supportNativeTranslation: false,
  fontName: "comic_neue_bold",
  ...extra,
});

export const DEVICE_FONT = "device:";
const FONT_SIZE_PREF = "fontSizePref";
const FONT_NAME_PREF = "fontNamePref";
const DIALOG_BOX_SCALE_PREF = "dialogBoxScalePref";
const DISABLE_WORD_BREAK_PREF = "disableWordBreakPref";
const DISABLE_TRANSLATOR_PREF = "disableTranslatorPref";
const TRANSLATE_SYNOPSIS_PREF = "translateSynopsisPref";
const TRANSLATOR_PROVIDER_PREF = "translatorProviderPref";
const CUSTOM_UA_PREF = "customUserAgentPref";
const DEFAULT_FONT_SIZE = "28";

/** Kotlin's Float.toString(): 1.0 -> "1.0" */
const floatString = (f: number) => (Number.isInteger(f) ? f.toFixed(1) : String(f));

export default class Manhuarm extends Madara {
  private _language?: Language;
  private get language(): Language {
    return (this._language ??= (() => {
      switch (this.lang) {
        case "ar":
          return Language(this.lang, this.lang, { disableFontSettings: true });
        case "fr":
        case "id":
          return Language(this.lang, this.lang, { supportNativeTranslation: true });
        case "pt-BR":
          return Language(this.lang, "pt", { supportNativeTranslation: true });
        default:
          return Language(this.lang);
      }
    })());
  }

  protected override useNewChapterEndpoint = true;

  private get fontSize(): number {
    return Number(this.preferences.getString(FONT_SIZE_PREF, DEFAULT_FONT_SIZE));
  }
  private get dialogBoxScale(): number {
    return Number(this.preferences.getString(DIALOG_BOX_SCALE_PREF, floatString(this.language.dialogBoxScale)));
  }
  private get fontName(): string {
    return this.preferences.getString(FONT_NAME_PREF, this.language.fontName)!;
  }
  private get disableWordBreak(): boolean {
    return this.preferences.getBoolean(DISABLE_WORD_BREAK_PREF, this.language.disableWordBreak);
  }
  private get disableTranslator(): boolean {
    return this.preferences.getBoolean(DISABLE_TRANSLATOR_PREF, this.language.disableTranslator);
  }
  private get translateSynopsis(): boolean {
    return this.preferences.getBoolean(TRANSLATE_SYNOPSIS_PREF, this.language.translateSynopsis);
  }
  private get customUserAgent(): string {
    return this.preferences.getString(CUSTOM_UA_PREF, "")!;
  }

  private _i18n?: Intl;
  private get i18n(): Intl {
    return (this._i18n ??= new Intl({ language: this.language.lang, baseLanguage: "en", availableLanguages: ["en", "es", "fr", "id", "it", "pt-BR"], messages }));
  }

  private readonly translators = ["Bing", "Google"];

  private get provider(): string {
    return this.preferences.getString(TRANSLATOR_PROVIDER_PREF, this.translators[0])!;
  }

  // CloudflareWarmupInterceptor: on the first failed response, load the home page once and retry.
  private isWarmedUp = false;

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .connectTimeout(60_000)
      .readTimeout(120_000)
      .addChainInterceptor(async (chain) => {
        const request = chain.request();
        const response = await chain.proceed(request);
        if (!response.isSuccessful && !this.isWarmedUp) {
          try {
            await chain.proceed(GET(this.baseUrl, this.headers));
            this.isWarmedUp = true;
          } catch {
            // ignored, as upstream
          }
          return chain.proceed(request);
        }
        return response;
      })
      .rateLimit(2, 1000);
  }

  private _clientUtils?: HttpClient;
  private get clientUtils(): HttpClient {
    return (this._clientUtils ??= new HttpClient(this.host, () => this.headers, new ClientBuilder().rateLimit(3, 2000)));
  }

  /** Upstream builds it with the client (rebuilt when settings change); here it follows the current preference. */
  private _translator?: [string, TranslatorEngine];
  private get translator(): TranslatorEngine {
    if (this._translator?.[0] !== this.provider) {
      this._translator = [this.provider, this.provider === "Google" ? new GoogleTranslator(this.clientUtils, this.headers) : new BingTranslator(this.clientUtils, this.headers)];
    }
    return this._translator[1];
  }

  override headersBuilder(): Headers {
    const builder = super.headersBuilder();
    const ua = this.customUserAgent.trim();
    if (ua) builder.set("User-Agent", ua);
    return builder;
  }

  private readonly translationAvailability = new Date(2025, 8, 9, 0, 0, 0, 0).getTime();

  // =========================== Popular ==========================================

  protected override popularMangaRequest(page: number): Request {
    const url = page === 1 ? `${this.baseUrl}/manga/?m_orderby=trending` : `${this.baseUrl}/manga/page/${page}/?m_orderby=trending`;
    return GET(url, this.headers);
  }

  protected override popularMangaSelector(): string {
    return ".page-item-detail, .manga-card";
  }

  protected override popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const titleEl = element.selectFirst(".post-title a, .manga-title a");
    const thumbEl = element.selectFirst(".item-thumb img, .manga-thumb img, img");
    manga.url = urlWithoutDomain(titleEl!.attr("href"));
    manga.title = titleEl!.text();
    manga.thumbnail_url = this.extractCoverUrl(thumbEl) ?? undefined;
    return manga;
  }

  protected override popularMangaNextPageSelector(): string {
    return "a.next, a.nextpostslink, .pagination a.next, .navigation-ajax #navigation-ajax";
  }

  // =========================== Latest ==========================================

  protected override latestUpdatesRequest(page: number): Request {
    const url = page === 1 ? `${this.baseUrl}/manga/?m_orderby=latest` : `${this.baseUrl}/manga/page/${page}/?m_orderby=latest`;
    return GET(url, this.headers);
  }

  protected override latestUpdatesSelector(): string {
    return this.popularMangaSelector();
  }

  protected override latestUpdatesFromElement(element: Element): SManga {
    const manga = SManga.create();
    const titleEl = element.selectFirst(".manga-title a") ?? element.selectFirst(".post-title a, h3.h5 a, .post-title h3 a");
    const thumbEl = element.selectFirst(".manga-thumb img") ?? element.selectFirst(".item-thumb img, img");
    manga.url = urlWithoutDomain(titleEl!.attr("href"));
    manga.title = titleEl!.text();
    manga.thumbnail_url = this.extractCoverUrl(thumbEl) ?? undefined;
    return manga;
  }

  protected override latestUpdatesNextPageSelector(): string {
    return this.popularMangaNextPageSelector();
  }

  // =========================== Details ==========================================

  /** Extracts the cover image URL from an image element, checking multiple attributes (lazy loading, formats). */
  private extractCoverUrl(el: Element | null): string | null {
    if (el == null) return null;
    // Try data-src first (lazy loading)
    const dataSrc = el.absUrl("data-src");
    if (dataSrc.trim() && !dataSrc.includes("data:image")) return dataSrc;
    // Try src attribute
    const src = el.absUrl("src");
    if (src.trim() && !src.includes("data:image") && !src.includes("placeholder")) return src;
    // Try srcset attribute (parse first URL)
    const srcset = el.attr("srcset");
    if (srcset.trim()) {
      const url = srcset.split(",")[0]?.trim().split(" ")[0];
      if (url != null) {
        if (url.startsWith("http")) return url;
        // absUrl(url) reads an attribute named like the URL, as upstream does
        const abs = el.absUrl(url);
        if (abs.trim() && !abs.includes("data:image")) return abs;
      }
    }
    return null;
  }

  protected override async mangaDetailsParse(document: Document | Response): Promise<SManga> {
    if (!("select" in document)) document = document.asJsoup();
    const manga = await super.mangaDetailsParse(document);

    if (this.translateSynopsis && this.language.target !== this.language.origin && manga.description?.trim()) {
      manga.description = await this.translator.translate(this.language.origin, this.language.target, manga.description);
    }

    const coverEl = document.selectFirst(".summary_image img, .wp-post-image, .item-thumb img, .manga-thumb img, img.wp-post-image");
    // Ensure cover is always set from detail page if it wasn't set from listing
    if (!manga.thumbnail_url?.trim()) {
      manga.thumbnail_url = this.extractCoverUrl(coverEl) ?? undefined;
    } else {
      // Even if cover was set, try to get a better quality version from detail page
      const it = this.extractCoverUrl(coverEl);
      if (it != null && it.trim() && !it.includes("placeholder")) manga.thumbnail_url = it;
    }
    return manga;
  }

  // =========================== Chapters =======================================

  protected override async chapterListParse(response: Response): Promise<SChapter[]> {
    return (await super.chapterListParse(response)).filter((it) => this.language.target === this.language.origin || it.date_upload > this.translationAvailability);
  }

  // =========================== Pages ==========================================

  protected override async pageListParse(document: Document | Response): Promise<Page[]> {
    // Upstream then asks OcrUrlInterceptor (a WebView running the site's scripts) for the dialogue request and
    // returns these pages unchanged when it finds none; see the file header.
    return super.pageListParse(document);
  }

  override imageRequest(page: Page): Request {
    const imageHeaders = this.headersBuilder();
    imageHeaders.set("Accept", "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5");
    imageHeaders.set("Referer", `${this.baseUrl}/`);
    imageHeaders.set("Connection", "keep-alive");
    imageHeaders.set("Accept-Language", "pt-BR,en-US;q=0.9,en;q=0.8");
    imageHeaders.set("Accept-Encoding", "gzip, deflate, br, zstd");
    imageHeaders.set("Sec-Fetch-Dest", "image");
    imageHeaders.set("Sec-Fetch-Mode", "no-cors");
    imageHeaders.set("Sec-Fetch-Site", "cross-site");
    imageHeaders.set("Sec-Fetch-Storage-Access", "none");
    imageHeaders.set("Priority", "u=5, i");
    imageHeaders.set("TE", "trailers");
    return GET(page.imageUrl!, imageHeaders);
  }

  // ================================ Utils ============================================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const i18n = this.i18n;
    // Some libreoffice font sizes
    const sizes = ["12", "13", "14", "15", "16", "18", "20", "21", "22", "24", "26", "28", "32", "36", "40", "42", "44", "48", "54", "60", "72", "80", "88", "96"];
    const scale = Array.from({ length: 11 }, (_, it) => 1 + it / 10);
    const fonts: [string, string][] = [
      [i18n.get("font_name_device_title"), DEVICE_FONT],
      ["Anime Ace", "animeace2_regular"],
      ["Comic Neue", "comic_neue_bold"],
      ["Coming Soon", "coming_soon_regular"],
    ];

    const fontSize = new ListPreference(screen.context);
    fontSize.key = FONT_SIZE_PREF;
    fontSize.title = i18n.get("font_size_title");
    fontSize.entries = sizes.map((it) => `${it}pt` + (it === DEFAULT_FONT_SIZE ? ` - ${i18n.get("default_font_size")}` : ""));
    fontSize.entryValues = sizes;
    fontSize.summary = `${i18n.get("font_size_summary")}\n\t* %s`;
    fontSize.setDefaultValue(String(this.fontSize));
    screen.addPreference(fontSize);

    const boxScale = new ListPreference(screen.context);
    boxScale.key = DIALOG_BOX_SCALE_PREF;
    boxScale.title = i18n.get("dialog_box_scale_title");
    boxScale.entries = scale.map((it) => `${floatString(it)}x` + (it === 1 ? ` - ${i18n.get("dialog_box_scale_default")}` : ""));
    boxScale.entryValues = scale.map(floatString);
    boxScale.summary = `${i18n.get("dialog_box_scale_summary")}\n\t* %s`;
    boxScale.setDefaultValue(floatString(this.dialogBoxScale));
    screen.addPreference(boxScale);

    if (!this.language.disableFontSettings) {
      const fontName = new ListPreference(screen.context);
      fontName.key = FONT_NAME_PREF;
      fontName.title = i18n.get("font_name_title");
      fontName.entries = fonts.map(([n, v]) => n + (!v.trim() ? ` - ${i18n.get("default_font_name")}` : ""));
      fontName.entryValues = fonts.map((it) => it[1]);
      fontName.summary = `${i18n.get("font_name_summary")}\n\t* %s`;
      fontName.setDefaultValue(this.fontName);
      screen.addPreference(fontName);
    }

    const wordBreak = new SwitchPreferenceCompat(screen.context);
    wordBreak.key = DISABLE_WORD_BREAK_PREF;
    wordBreak.title = `⚠ ${i18n.get("disable_word_break_title")}`;
    wordBreak.summary = i18n.get("disable_word_break_summary");
    wordBreak.setDefaultValue(this.language.disableWordBreak);
    screen.addPreference(wordBreak);

    const ua = new EditTextPreference(screen.context);
    ua.key = CUSTOM_UA_PREF;
    ua.title = i18n.get("custom_user_agent_title");
    ua.summary = i18n.get("custom_user_agent_message");
    ua.setDefaultValue(this.customUserAgent);
    screen.addPreference(ua);

    if (this.language.target === this.language.origin) return;

    if (this.language.supportNativeTranslation) {
      const disable = new SwitchPreferenceCompat(screen.context);
      disable.key = DISABLE_TRANSLATOR_PREF;
      disable.title = `⚠ ${i18n.get("disable_translator_title")}`;
      disable.summary = i18n.get("disable_translator_summary");
      disable.setDefaultValue(this.language.disableTranslator);
      screen.addPreference(disable);
    }

    const synopsis = new SwitchPreferenceCompat(screen.context);
    synopsis.key = TRANSLATE_SYNOPSIS_PREF;
    synopsis.title = i18n.get("translate_synopsis_title");
    synopsis.summary = i18n.get("translate_synopsis_summary");
    synopsis.setDefaultValue(this.language.translateSynopsis);
    screen.addPreference(synopsis);

    if (!this.disableTranslator || this.translateSynopsis) {
      const provider = new ListPreference(screen.context);
      provider.key = TRANSLATOR_PROVIDER_PREF;
      provider.title = i18n.get("translate_dialog_box_title");
      provider.entries = this.translators;
      provider.entryValues = this.translators;
      provider.summary = `${i18n.get("translate_dialog_box_summary")}\n\t* %s`;
      provider.setDefaultValue(this.translators[0]);
      screen.addPreference(provider);
    }
  }
}
