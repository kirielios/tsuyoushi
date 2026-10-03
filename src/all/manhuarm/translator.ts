// Port of keiyoushi/extensions-source src/all/manhuarm/translator/ (TranslatorEngine.kt, bing/BingTranslator.kt,
// bing/BingTranslatorDto.kt, google/GoogleTranslator.kt)
import { GET, POST, toHttpUrl, type HttpClient, type Request } from "../../../sdk/index.ts";

export interface TranslatorEngine {
  readonly capacity: number;
  translate(from: string, to: string, text: string): Promise<string>;
}

class TokenGroup {
  constructor(
    readonly token = "",
    readonly key = "",
    readonly iid = "",
    readonly ig = "",
  ) {}
  isNotValid() {
    return [this.token, this.key, this.iid, this.ig].some((it) => !it.trim());
  }
  isValid() {
    return !this.isNotValid();
  }
}

interface TranslateDto {
  translations: { text: string }[];
}

const TOKENS_REGEX = /params_AbusePreventionHelper(\s+)?=(\s+)?[^[]\[(\d+),"([^"]+)/;
const IG_PARAM_REGEX = /IG:"([^"]+)/;

export class BingTranslator implements TranslatorEngine {
  private readonly baseUrl = "https://www.bing.com";
  private readonly translatorUrl = `${this.baseUrl}/translator`;
  private tokens = new TokenGroup();
  readonly capacity = 1000;
  private readonly attempts = 3;

  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {}

  async translate(from: string, to: string, text: string): Promise<string> {
    if (this.tokens.isNotValid() && !(await this.refreshTokens())) return text;
    const request = this.translatorRequest(from, to, text);
    for (let i = 0; i < this.attempts; i++) {
      try {
        return await this.fetchTranslatedText(request);
      } catch {
        await this.refreshTokens();
      }
    }
    return text;
  }

  private async fetchTranslatedText(request: Request): Promise<string> {
    const dto = (await this.client.execute(request)).parseAs<TranslateDto[]>()[0]!;
    return dto.translations[0]?.text ?? "";
  }

  private async refreshTokens(): Promise<boolean> {
    this.tokens = await this.loadTokens();
    return this.tokens.isValid();
  }

  private translatorRequest(from: string, to: string, text: string): Request {
    const url = toHttpUrl(`${this.baseUrl}/ttranslatev3`)
      .newBuilder()
      .addQueryParameter("isVertical", "1")
      .addQueryParameter("", "") // Present in Bing URL
      .addQueryParameter("IG", this.tokens.ig)
      .addQueryParameter("IID", this.tokens.iid)
      .build();
    const headersApi = new Headers(this.headers);
    headersApi.set("Accept", "*/*");
    headersApi.set("Origin", this.baseUrl);
    headersApi.set("Referer", this.translatorUrl);
    headersApi.set("Alt-Used", this.baseUrl);
    const payload = new URLSearchParams({ fromLang: from, to, text, tryFetchingGenderDebiasedTranslations: "true", token: this.tokens.token, key: this.tokens.key });
    return POST(url.toString(), headersApi, payload);
  }

  private async loadTokens(): Promise<TokenGroup> {
    const document = (await this.client.execute(GET(this.translatorUrl, this.headers))).asJsoup();
    const scripts = document.select("script").map((it) => it.data());
    const scriptOne = scripts.find((it) => TOKENS_REGEX.test(it));
    if (scriptOne == null) return new TokenGroup();
    const scriptTwo = scripts.find((it) => IG_PARAM_REGEX.test(it));
    if (scriptTwo == null) return new TokenGroup();
    const matchOne = TOKENS_REGEX.exec(scriptOne);
    const matchTwo = IG_PARAM_REGEX.exec(scriptTwo);
    return new TokenGroup(matchOne?.[4] ?? "", matchOne?.[3] ?? "", document.selectFirst("div[data-iid]:not([class])")?.attr("data-iid") ?? "", matchTwo?.[1] ?? "");
  }
}

/** This client is an adaptation of the following python repository: https://github.com/ssut/py-googletrans. */
export class GoogleTranslator implements TranslatorEngine {
  private readonly baseUrl = "https://translate.googleapis.com";
  private readonly webpage = "https://translate.google.com";
  private readonly translatorUrl = `${this.baseUrl}/translate_a/single`;
  readonly capacity = 5000;

  constructor(
    private readonly client: HttpClient,
    private readonly headers: Headers,
  ) {}

  async translate(from: string, to: string, text: string): Promise<string> {
    const request = this.translateRequest(text, from, to);
    try {
      return await this.fetchTranslatedText(request);
    } catch {
      return text;
    }
  }

  private translateRequest(text: string, from: string, to: string): Request {
    return GET(this.clientUrlBuilder(text, from, to).build(), this.headersBuilder());
  }

  private headersBuilder(): Headers {
    const h = new Headers(this.headers);
    h.set("Origin", this.webpage);
    h.set("Alt-Used", this.webpage.split("/").pop()!);
    h.set("Referer", `${this.webpage}/`);
    return h;
  }

  private clientUrlBuilder(text: string, src: string, dest: string, token = "xxxx") {
    const b = toHttpUrl(this.translatorUrl)
      .newBuilder()
      .setQueryParameter("client", "gtx")
      .setQueryParameter("sl", src)
      .setQueryParameter("tl", dest)
      .setQueryParameter("hl", dest)
      .setQueryParameter("ie", "UTF-8")
      .setQueryParameter("oe", "UTF-8")
      .setQueryParameter("otf", "1")
      .setQueryParameter("ssel", "0")
      .setQueryParameter("tsel", "0")
      .setQueryParameter("tk", token)
      .setQueryParameter("q", text);
    for (const it of ["at", "bd", "ex", "ld", "md", "qca", "rw", "rm", "ss", "t"]) b.addQueryParameter("dt", it);
    return b;
  }

  private async fetchTranslatedText(request: Request): Promise<string> {
    const response = await this.client.execute(request);
    if (!response.isSuccessful) throw new Error(`Request failed: ${response.code}`);
    const data = response.parseAs<unknown[][][]>();
    return data[0].map((it) => String(it[0])).join("");
  }
}
