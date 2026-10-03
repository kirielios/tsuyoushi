// Port of keiyoushi/extensions-source src/all/dragonballmultiverse/DbMultiverse.kt
import {
  Canvas,
  GET,
  HttpSource,
  MangasPage,
  Page,
  Response,
  SChapter,
  SManga,
  imageSize,
  parseAs,
  substringAfter,
  substringBefore,
  toJsonString,
  urlWithoutDomain,
  type ChainInterceptor,
  type ClientBuilder,
  type FilterList,
  type Request,
} from "../../../sdk/index.ts";

interface PageLayout {
  scale: number;
  balloons: BalloonBox[];
}

interface BalloonBox {
  text: string;
  left: number;
  top: number;
  width: number;
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** Kotlin's String.toFloatOrNull(): null when the text is not a float. */
const toFloatOrNull = (s: string): number | null => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim()) ? parseFloat(s) : null);

export default class DbMultiverse extends HttpSource {
  private get internalLang(): string {
    switch (this.lang) {
      case "en":
        return "en";
      case "fr":
        return this.name.endsWith("Parody") ? "fr_PA" : "fr";
      case "ja":
        return "jp";
      case "zh":
        return "cn";
      case "es":
        return "es";
      case "it":
        return "it";
      case "pt":
        return "pt";
      case "de":
        return "de";
      case "pl":
        return "pl";
      case "nl":
        return "nl";
      case "tr":
        return "tr_TR";
      case "pt-BR":
        return "pt_BR";
      case "hu":
        return "hu_HU";
      case "ga":
        return "ga_ES";
      case "ca":
        return "ct_CT";
      case "no":
        return "no_NO";
      case "ru":
        return "ru_RU";
      case "ro":
        return "ro_RO";
      case "eu":
        return "eu_EH";
      case "lt":
        return "lt_LT";
      case "hr":
        return "hr_HR";
      case "ko":
        return "kr_KR";
      case "fi":
        return "fi_FI";
      case "he":
        return "he_HE";
      case "bg":
        return "bg_BG";
      case "sv":
        return "sv_SE";
      case "el":
        return "gr_GR";
      case "es-419":
        return "es_CO";
      case "ar":
        return "ar_JO";
      case "fil":
        return "tl_PI";
      case "la":
        return "la_LA";
      case "da":
        return "da_DK";
      case "co":
        return "co_FR";
      case "br":
        return "br_FR";
      case "vec":
        return "xx_VE";
      case "lmo":
        return "xx_LMO";
      default:
        return this.lang;
    }
  }

  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(this.drawBalloonsOnImage());
  }

  protected popularMangaRequest(_page: number): Request {
    return GET(`${this.baseUrl}/${this.internalLang}/read.html`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("#dbm-reads .dbm-read").map((element) => {
      const manga = SManga.create();
      manga.title = element.selectFirst("h3")!.text();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.attr("abs:href"));
      manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
      manga.description = element.selectFirst("> div")?.text();
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  override async fetchMangaDetails(manga: SManga): Promise<SManga> {
    manga.initialized = true;
    return manga;
  }

  protected chapterListSelector = ".cadrelect.chapter";

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    return document
      .select(this.chapterListSelector)
      .map((it) => {
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(it.selectFirst("a[href]")!.attr("abs:href"));
        chapter.name = it.selectFirst("h4")!.text();
        return chapter;
      })
      .reverse();
  }

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    return document.select(".pageslist a[href]").map((a, index) => new Page(index, a.attr("abs:href")));
  }

  protected imageUrlParse(response: Response): string {
    const document = response.asJsoup();
    const element = document.selectFirst("#balloonsimg")!;

    let rawImageUrl: string;
    if (element.hasAttr("src")) rawImageUrl = element.attr("abs:src");
    else if (element.selectFirst("img") != null) rawImageUrl = element.selectFirst("img")!.attr("abs:src");
    else {
      const styleUrl = substringBefore(substringAfter(element.attr("style"), "url("), ")");
      const cleanUrl = this.removeSurrounding(this.removeSurrounding(styleUrl, '"'), "'");
      rawImageUrl = cleanUrl.startsWith("http") ? cleanUrl : this.baseUrl + cleanUrl;
    }

    const balloons: BalloonBox[] = element.select(".balloon").map((b) => {
      const style = b.attr("style");
      return {
        text: b.text(),
        left: this.extractCssProp(style, "left"),
        top: this.extractCssProp(style, "top"),
        width: this.extractCssProp(style, "width"),
      };
    });

    const pageData: PageLayout = {
      scale: toFloatOrNull(substringBefore(substringAfter(element.attr("style"), "scale(", ""), ")", "")) ?? 1,
      balloons,
    };

    return balloons.length > 0 ? `${rawImageUrl}#${toJsonString(pageData)}` : rawImageUrl;
  }

  private removeSurrounding(s: string, d: string): string {
    return s.length >= 2 * d.length && s.startsWith(d) && s.endsWith(d) ? s.slice(d.length, s.length - d.length) : s;
  }

  private extractCssProp(s: string, prop: string, def = "0"): number {
    const digits = [...substringBefore(substringAfter(s, `${prop}:`, def), ";")].filter((c) => (c >= "0" && c <= "9") || c === ".").join("");
    return toFloatOrNull(digits) ?? 0;
  }

  /** drawBalloonsOnImage: the page's speech balloon texts are drawn onto the image and re-encoded as JPEG. */
  private drawBalloonsOnImage(): ChainInterceptor {
    return async (chain) => {
      const request = chain.request();
      const response = await chain.proceed(request);

      const hash = request.url.indexOf("#");
      const rawFragment = hash < 0 ? "" : request.url.slice(hash + 1);
      if (!rawFragment) return response;

      let fragment = rawFragment;
      try {
        fragment = decodeURIComponent(rawFragment);
      } catch {
        // a lone '%' stays as it is, like HttpUrl's decoder
      }
      const page = parseAs<PageLayout>(fragment);

      const bytes = response.bytes();
      const { width, height } = await imageSize(this.host, bytes);
      const canvas = new Canvas(this.host, width, height);
      canvas.drawImage(bytes, 0, 0, width, height, 0, 0);

      // Canvas has no text: each balloon becomes an SVG layer (TextPaint: black, 14px sans-serif, centred, wrapped to the balloon width).
      for (const b of page.balloons) {
        const x = b.left * page.scale;
        const y = b.top * page.scale;
        const w = Math.max(Math.trunc(b.width * page.scale), 1);
        const svg = this.balloonSvg(b.text, w);
        if (!svg) continue;
        canvas.drawImage(new TextEncoder().encode(svg.svg), 0, 0, w, svg.height, Math.round(x), Math.round(y));
      }

      return Response.of(request.url, await canvas.encode("jpeg", 95), "image/jpeg");
    };
  }

  // ponytail: glyph widths are estimated (no font metrics here), like libs/textinterceptor; exact StaticLayout breaking is out of reach
  private balloonSvg(text: string, w: number): { svg: string; height: number } | null {
    const fontSize = 14;
    const lineHeight = Math.ceil(fontSize * 1.17);
    const charWidth = (c: string) => {
      const cp = c.codePointAt(0)!;
      if (cp >= 0x2e80) return 1;
      if (" .,:;'|!il ".includes(c)) return 0.28;
      if ("fjrtI()[]\"-".includes(c)) return 0.36;
      if ("mwMW@".includes(c)) return 0.85;
      if (c >= "A" && c <= "Z") return 0.66;
      return 0.54;
    };
    const measure = (s: string) => [...s].reduce((sum, c) => sum + charWidth(c) * fontSize, 0);
    const lines: string[] = [];
    let line = "";
    for (const word of text.match(/\S+\s*|\s+/g) ?? []) {
      if (measure(line + word.trimEnd()) <= w) {
        line += word;
        continue;
      }
      if (line) lines.push(line.trimEnd());
      line = "";
      for (const c of word.trimEnd()) {
        if (line && measure(line + c) > w) (lines.push(line), (line = ""));
        line += c;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
    if (!lines.length) return null;
    const height = lines.length * lineHeight;
    const body = lines.map((l, i) => `<text x="${w / 2}" y="${i * lineHeight + fontSize}" text-anchor="middle">${escapeXml(l)}</text>`).join("");
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}"><g font-family="sans-serif" font-size="${fontSize}" fill="#000">${body}</g></svg>`, height };
  }

  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }

  override async fetchSearchManga(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  protected searchMangaParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }

  protected searchMangaRequest(_page: number, _query: string, _filters: FilterList): Request {
    throw new Error("UnsupportedOperationException");
  }

  protected mangaDetailsParse(_response: Response): SManga {
    throw new Error("UnsupportedOperationException");
  }
}
