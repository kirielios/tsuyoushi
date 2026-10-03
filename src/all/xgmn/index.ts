// Port of keiyoushi/extensions-source src/all/xgmn/XGMN.kt (+ Filters.kt)
import { DateTimeFormatter, Filter, FilterList, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, ZoneId, substringAfter, substringBeforeLast, toHttpUrl, urlWithoutDomain, type Element, type Request, type Response } from "../../../sdk/index.ts";

// --- Filters.kt
class CategoryFilter extends Filter.Select<string> {
  constructor() {
    super("分类（搜索时无效）", [
      "秀人网", "美媛馆", "尤物馆", "爱蜜社", "蜜桃社", "优星馆", "嗲囡囡",
      "魅妍社", "兔几盟", "影私荟", "星乐园", "顽味生活", "模范学院",
      "花の颜", "御女郎", "网红馆", "尤蜜荟", "薄荷叶", "瑞丝馆", "模特联盟",
      "花漾", "星颜社", "画语界", "推女郎", "尤果网", "青豆客", "头条女神",
      "果团网", "喵糖映画", "爱尤物", "波萝社", "猎女神", "尤蜜", "潘多拉",
      "Artgravia", "DJAWA", "丝袜美腿", "美腿宝贝", "蜜丝", "妖精社",
      "性感尤物", "国产美女", "港台美女", "日韩美女", "欧美美女", "丝袜美腿",
      "内衣尤物", "Cosplay",
    ]); // prettier-ignore
  }
  override toString() {
    return [
      "Xiuren/", "MyGirl/", "YouWu/", "IMiss/", "MiiTao/", "Uxing/", "FeiLin/",
      "MiStar/", "Tukmo/", "WingS/", "LeYuan/", "Taste/", "MFStar/", "Huayan/",
      "DKGirl/", "Candy/", "YouMi/", "MintYe/", "Micat/", "Mtmeng/", "HuaYang/",
      "XingYan/", "XiaoYu/", "Tuigirl/", "Ugirls/", "Tgod/", "TouTiao/", "Girlt/",
      "Mtcos/", "Aiyouwu/", "BoLoli/", "Slady/", "YouMei/", "Pdl/", "Artgravia/",
      "DJAWA/", "Siwameitui/", "LEGBABY/", "MissLeg/", "YaoJingShe/", "Xgyw/",
      "Guochanmeinv/", "Gangtaimeinv/", "Rihanmeinv/", "Oumeimeinv/",
      "Siwameitui/", "Neiyiyouwu/", "Cosplay/",
    ][this.state]; // prettier-ignore
  }
}

const buildFilterList = (): FilterList => FilterList(new CategoryFilter());

const ID_REGEX = /\d+(?=\.html)/;
const PAGE_SIZE_REGEX = /\d+(?=P)/;
const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy.MM.dd", Locale.ROOT).withZone(ZoneId.of("Asia/Shanghai"));

/** String.toInt(): throws on anything but an integer, as NumberFormatException. */
function toInt(s: string): number {
  if (!/^[+-]?\d+$/.test(s)) throw new Error(`For input string: "${s}"`);
  return Number.parseInt(s, 10);
}

export default class XGMN extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  private redirectUrl: string | null = null;

  private get currentBaseUrl(): string {
    return this.redirectUrl ?? this.baseUrl;
  }

  private rememberRedirect(location: string) {
    this.redirectUrl ??= ((it) => `${it.scheme}://${it.host}`)(toHttpUrl(location));
  }

  protected popularMangaRequest(_page: number): Request {
    return GET(`${this.currentBaseUrl}/top.html`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const doc = response.asJsoup();
    this.rememberRedirect(doc.location());
    const curText = doc.selectFirst(".current")?.text();
    const cur = curText != null ? toInt(curText) : null;
    return new MangasPage(
      doc.select(".related_box").map((box) => {
        const manga = SManga.create();
        manga.thumbnail_url = box.selectFirst("img")?.absUrl("src");
        const a = box.selectFirst("a")!;
        manga.title = a.attr("title");
        manga.url = urlWithoutDomain(a.absUrl("href"));
        return manga;
      }),
      cur != null && cur < toInt(doc.selectFirst(".pagination strong")!.text()),
    );
  }

  protected latestUpdatesRequest(_page: number): Request {
    return GET(`${this.currentBaseUrl}/new.html`, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const url = toHttpUrl(this.currentBaseUrl).newBuilder();
    if (query.trim().length > 0) {
      url.addPathSegments("plus/search/index.asp").addQueryParameter("keyword", query).addQueryParameter("p", String(page));
    } else {
      url.addPathSegments(filters[0].toString());
      if (page > 1) url.addPathSegment(`page_${page}.html`);
    }
    return GET(url.build().toString(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    if (!toHttpUrl(response.url).pathSegments.includes("search")) return this.popularMangaParse(response);
    const doc = response.asJsoup();
    this.rememberRedirect(doc.location());
    const current = toInt(doc.selectFirst(".current")!.text());
    return new MangasPage(
      doc.select(".node > p > a").map((it: Element) => {
        const manga = SManga.create();
        manga.title = it.text();
        manga.url = urlWithoutDomain(it.absUrl("href"));
        manga.thumbnail_url = `${this.currentBaseUrl}/uploadfile/pic/${ID_REGEX.exec(manga.url)?.[0] ?? null}.jpg`;
        return manga;
      }),
      current < doc.select(".list .pagination a").length,
    );
  }

  protected mangaDetailsParse(response: Response): SManga {
    const doc = response.asJsoup();
    this.rememberRedirect(doc.location());
    const manga = SManga.create();
    const author = doc.selectFirst(".item-2")?.text();
    manga.author = author == null ? undefined : substringAfter(author, "模特：");
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
    manga.status = SManga.COMPLETED;
    return manga;
  }

  protected chapterListParse(response: Response): SChapter[] {
    const doc = response.asJsoup();
    this.rememberRedirect(doc.location());
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(doc.selectFirst(".current")!.absUrl("href"));
    chapter.name = doc.selectFirst(".article-title")!.text();
    chapter.chapter_number = 1;
    const updated = doc.selectFirst(".item-1")?.text();
    chapter.date_upload = DATE_FORMAT.tryParseDate(updated == null ? null : substringAfter(updated, "更新："));
    return [chapter];
  }

  protected pageListParse(response: Response): Page[] {
    const doc = response.asJsoup();
    const prefix = substringBeforeLast(doc.selectFirst(".current")!.absUrl("href"), ".html");
    const total = PAGE_SIZE_REGEX.exec(doc.selectFirst(".article-title")!.text())![0];
    const size = doc.select(".article-content p > img").length;
    if (size === 0) throw new Error("/ by zero");
    return Array.from({ length: toInt(total) }, (_, it) => {
      const v = Math.floor(it / size);
      return new Page(it, `${prefix}${v === 0 ? "" : `_${v}`}.html#${(it % size) + 1}`);
    });
  }

  /** The fragment names the image to pick; the response's URL no longer carries it, so it is taken from the page's URL. */
  override async fetchImageUrl(page: Page): Promise<string> {
    const response = await this.executeSuccess(await this.imageUrlRequest(page));
    return this.parseImageUrl(response, new URL(page.url).hash.slice(1));
  }

  protected imageUrlParse(response: Response): string {
    return this.parseImageUrl(response, new URL(response.url).hash.slice(1));
  }

  private parseImageUrl(response: Response, seq: string): string {
    // //*[contains(@class,'article-content')]/p[@*[contains(.,'center')]]/img[position()=$seq]  (selectXpath(...).first())
    const n = toInt(seq);
    let url: Element | null = null;
    for (const p of response.asJsoup().select("[class*=article-content] > p")) {
      const attribs = (p.node as { attribs?: Record<string, string> }).attribs ?? {};
      if (!Object.values(attribs).some((v) => v.includes("center"))) continue;
      const img = p.children().filter((c) => c.tagName().toLowerCase() === "img")[n - 1];
      if (img) {
        url = img;
        break;
      }
    }
    if (url == null) throw new Error("没找到图片");
    return `${this.currentBaseUrl}/${this.getUrlWithoutDomain(url.absUrl("src"))}`;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return buildFilterList();
  }

  private getUrlWithoutDomain(url: string): string {
    const prefix = ["http://", "https://"].find((p) => url.startsWith(p));
    return substringAfter(substringAfter(url, prefix ?? ""), "/");
  }
}
