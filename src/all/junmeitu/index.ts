// Port of keiyoushi/extensions-source src/all/junmeitu/Junmeitu.kt (+ Filters.kt, Dto.kt)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  firstInstanceOrNull,
  parseHtml,
  substringAfter,
  substringBefore,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  type Element,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

// --- Filters.kt
class SelectFilterOption {
  constructor(
    readonly name: string,
    readonly value: string = name,
  ) {}
}

abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: SelectFilterOption[],
    def = 0,
  ) {
    super(
      name,
      options.map((it) => it.name),
      def,
    );
  }
  get selected(): string {
    return this.options[this.state].value;
  }
  get slug(): string {
    return this.options[this.state].name;
  }
}

class TagFilter extends Filter.Text {
  constructor() {
    super("Tag");
  }
}
class ModelFilter extends Filter.Text {
  constructor() {
    super("Model");
  }
}
class GroupFilter extends Filter.Text {
  constructor() {
    super("Group");
  }
}
class CategoryFilter extends SelectFilter {
  constructor(options: SelectFilterOption[], def: number) {
    super("Category", options, def);
  }
}
class SortFilter extends SelectFilter {
  constructor(options: SelectFilterOption[], def: number) {
    super("Sort", options, def);
  }
}

const getCategoryFilter = () => [new SelectFilterOption("beauty", "6"), new SelectFilterOption("handsome", "5"), new SelectFilterOption("news", "30"), new SelectFilterOption("street", "32")];

const getSortFilter = () => [new SelectFilterOption("default", "index"), new SelectFilterOption("hot")];

/** takeIf { it.isNotEmpty() } ?: ... chain over the lazy-load attributes */
const imgSrc = (img: Element): string => {
  for (const attr of ["abs:data-original", "abs:data-src", "abs:data-lazy-src"]) {
    const v = img.attr(attr);
    if (v.length > 0) return v;
  }
  return img.attr("abs:src");
};

export default class Junmeitu extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ENGLISH);

  protected latestUpdatesRequest(page: number): Request {
    return GET(`${this.baseUrl}/beauty/index-${page}.html`, this.headers);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected popularMangaRequest(page: number): Request {
    return GET(`${this.baseUrl}/beauty/hot-${page}.html`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(".pic-list > ul > li").map((element) => {
      const manga = SManga.create();
      manga.title = element.select("p").text();
      manga.thumbnail_url = element.select("img").attr("abs:src");
      manga.url = urlWithoutDomain(element.select("a").attr("abs:href"));
      return manga;
    });
    const hasNextPage = document.selectFirst("span + a  + a") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const tagFilter = firstInstanceOrNull(filters, TagFilter);
    const modelFilter = firstInstanceOrNull(filters, ModelFilter);
    const groupFilter = firstInstanceOrNull(filters, GroupFilter);
    const categoryFilter = firstInstanceOrNull(filters, CategoryFilter);
    const sortFilter = firstInstanceOrNull(filters, SortFilter);

    if (query.length > 0) return GET(`${this.baseUrl}/search/${query}-${page}.html`, this.headers);
    if (tagFilter != null && tagFilter.state.length > 0) return GET(`${this.baseUrl}/tags/${tagFilter.state}-${categoryFilter?.selected ?? "6"}-${page}.html`, this.headers);
    if (modelFilter != null && modelFilter.state.length > 0) return GET(`${this.baseUrl}/model/${modelFilter.state}-${page}.html`, this.headers);
    if (groupFilter != null && groupFilter.state.length > 0) return GET(`${this.baseUrl}/xzjg/${groupFilter.state}-${page}.html`, this.headers);
    if (categoryFilter != null && categoryFilter.state !== 0) return GET(`${this.baseUrl}/${categoryFilter.slug}/${sortFilter?.selected ?? "index"}-${page}.html`, this.headers);
    if (sortFilter != null && sortFilter.state !== 0) return GET(`${this.baseUrl}/${categoryFilter?.slug ?? "beauty"}/${sortFilter.selected}-${page}.html`, this.headers);
    return this.latestUpdatesRequest(page);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();
    manga.title = document.selectFirst(".news-title, .title")?.text() ?? "";
    manga.description = `${document
      .select(".news-info, .picture-details")
      .map((it) => it.text())
      .join(" ")}\n${document.select(".introduce").text()}`;
    manga.genre = document
      .select(".relation_tags > a")
      .map((it) => it.text())
      .join(", ");
    manga.status = SManga.COMPLETED;
    return manga;
  }

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    const chapter = SChapter.create();
    const urlElement = document.selectFirst(".position a:last-child");
    const href = urlElement?.attr("abs:href");
    chapter.url = urlWithoutDomain(href ? href : response.url);
    chapter.name = "Gallery";

    const dateText = substringAfter(document.select(".picture-details span.gao:contains(日期)").text(), "日期:").trim();
    chapter.date_upload = this.dateFormat.tryParseDate(dateText);
    return [chapter];
  }

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    const pages: Page[] = [];

    const newsBody = document.selectFirst(".news-body");
    if (newsBody != null) {
      newsBody.select("img").forEach((img, index) => pages.push(new Page(index, "", imgSrc(img))));
      return pages;
    }

    const numPagesText = document.select(".pages > a:nth-last-of-type(2)").text();
    const parsed = /^[+-]?\d+$/.test(numPagesText) ? Number.parseInt(numPagesText, 10) : null;
    const nums = document
      .select(".pages a")
      .map((it) => it.text())
      .filter((t) => /^[+-]?\d+$/.test(t))
      .map((t) => Number.parseInt(t, 10));
    const numPages = parsed ?? (nums.length > 0 ? Math.max(...nums) : 1);

    const scriptData = document.select("script").find((it) => it.data().includes("pc_cid"))?.data();

    const urlObj = toHttpUrl(response.url);
    const segs = urlObj.pathSegments;
    if (scriptData != null) {
      const categoryId = substringBefore(substringAfter(scriptData, "pc_cid = "), ";").trim();
      const contentId = substringBefore(substringAfter(scriptData, "pc_id = "), ";").trim();

      const cat = segs[0] ?? "beauty";
      const slugFull = segs[segs.length - 1] ?? "";
      const slug = substringBeforeLast(substringBefore(slugFull, ".html"), "-");

      const ajaxBuilder = urlObj.newBuilder();
      if (segs.length > 0) ajaxBuilder.setPathSegment(0, `ajax_${cat}`);
      ajaxBuilder.removeAllQueryParameters("ajax");
      ajaxBuilder.removeAllQueryParameters("catid");
      ajaxBuilder.removeAllQueryParameters("conid");
      ajaxBuilder.addQueryParameter("ajax", "1");
      ajaxBuilder.addQueryParameter("catid", categoryId);
      ajaxBuilder.addQueryParameter("conid", contentId);
      const ajaxUrlBase = ajaxBuilder.build();
      const ajaxSize = ajaxUrlBase.pathSegments.length;

      const firstImageEl = document.selectFirst(".pictures img");
      const firstImage = firstImageEl ? imgSrc(firstImageEl) : null;

      if (firstImage) {
        pages.push(new Page(0, "", firstImage));
      } else {
        pages.push(new Page(0, ajaxUrlBase.newBuilder().setPathSegment(ajaxSize - 1, `${slug}-1.html`).build().toString()));
      }

      for (let i = 2; i <= numPages; i++) {
        pages.push(new Page(i - 1, ajaxUrlBase.newBuilder().setPathSegment(ajaxSize - 1, `${slug}-${i}.html`).build().toString()));
      }
    } else {
      const slugFull = segs[segs.length - 1] ?? "";
      const slug = substringBeforeLast(substringBefore(slugFull, ".html"), "-");

      for (let i = 1; i <= numPages; i++) {
        const pageUrl = urlObj
          .newBuilder()
          .setPathSegment(segs.length - 1, `${slug}${i > 1 ? `-${i}` : ""}.html`)
          .build()
          .toString();
        pages.push(new Page(i - 1, pageUrl));
      }
    }

    return pages;
  }

  protected imageUrlParse(response: Response): string {
    const contentType = response.header("Content-Type") ?? "";
    if (contentType.toLowerCase().includes("application/json") || toHttpUrl(response.url).queryParameter("ajax") === "1") {
      const pageDto = response.parseAs<{ pic: string }>();
      const img = parseHtml(this.host.load, pageDto.pic, this.baseUrl).selectFirst("img");
      return img?.attr("abs:src") ?? (() => {
        throw new Error("Image not found in AJAX response");
      })();
    }

    const document = response.asJsoup();
    const img = document.selectFirst(".pictures img");
    if (!img) throw new Error("Image not found in HTML response");
    return imgSrc(img);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("NOTE: Ignored if using text search!"),
      new Filter.Header("NOTE: Filter are weird for this extension!"),
      new Filter.Separator(),
      new TagFilter(),
      new ModelFilter(),
      new GroupFilter(),
      new CategoryFilter(getCategoryFilter(), 0),
      new SortFilter(getSortFilter(), 0),
    );
  }
}
