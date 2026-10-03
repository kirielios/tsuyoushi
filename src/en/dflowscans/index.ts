// Port of keiyoushi/extensions-source src/en/dflowscans/DFlowScans.kt (+ Dto.kt)
import { DateTimeFormatter, Filter, FilterList, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, firstInstance, toHttpUrl, urlWithoutDomain, type Request, type Response } from "../../../sdk/index.ts";

interface Dto {
  url: string;
  num: number;
}

export default class DFlowScans extends HttpSource {
  override get supportsLatest() {
    return false;
  }

  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM dd, yyyy", Locale.ENGLISH);

  protected popularMangaRequest(_page: number): Request {
    return GET(`${this.baseUrl}/Series`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  protected searchMangaRequest(_page: number, query: string, filters: FilterList): Request {
    const statusFilter = firstInstance(filters, StatusFilter);
    const url = toHttpUrl(`${this.baseUrl}/Series`).newBuilder().addQueryParameter("search", query).addQueryParameter("status", statusFilter.value);
    return GET(url.build(), this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(".col-lg-3.col-md-4.col-sm-6").map((it) => {
      const manga = SManga.create();
      manga.title = it.selectFirst(".manga-card-title")!.text();
      manga.thumbnail_url = it.selectFirst(".manga-card-image img")?.absUrl("src");
      manga.url = urlWithoutDomain(it.selectFirst(".manga-card-body a.btn")!.absUrl("href"));
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();
    manga.title = document.selectFirst("h1")!.text();
    manga.thumbnail_url = document.selectFirst(".col-md-4.col-lg-3 img")?.absUrl("src");
    manga.description = document.selectFirst(".col-md-8.col-lg-9 > p")?.text();
    manga.genre = document
      .select("div:has(> strong:containsOwn(Genres)) span")
      .map((it) => it.text())
      .join(", ");
    manga.author = document.selectFirst("div:has(> span:containsOwn(Author)) span + span")?.text();
    manga.artist = document.selectFirst("div:has(> span:containsOwn(Artist)) span + span")?.text();
    switch (document.selectFirst("div:has(> span:containsOwn(Status)) span + span")?.text()) {
      case "Ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "Completed":
        manga.status = SManga.COMPLETED;
        break;
      case "Hiatus":
        manga.status = SManga.ON_HIATUS;
        break;
      case "Dropped":
        manga.status = SManga.CANCELLED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    return manga;
  }

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();
    return document.select("div#chapters-section div:has(> a.btn-primary)").map((it) => {
      const chapter = SChapter.create();
      const chapterTitle = it.selectFirst("h5")!.text();
      let subTitle = it.selectFirst("p:not(:has(i.fa-calendar))")?.text();
      if (subTitle != null) {
        if (subTitle.endsWith(` - ${chapterTitle}`)) subTitle = subTitle.slice(0, -` - ${chapterTitle}`.length);
        if (subTitle.endsWith(` ${chapterTitle}`)) subTitle = subTitle.slice(0, -` ${chapterTitle}`.length);
      }
      chapter.name = subTitle == null || subTitle.length === 0 ? chapterTitle : `${chapterTitle} - ${subTitle}`;
      const date = it.selectFirst("p:has(i.fa-calendar)")?.text();
      chapter.date_upload = this.dateFormat.tryParseDate(date);
      chapter.url = urlWithoutDomain(it.selectFirst("a.btn-primary")!.absUrl("href"));
      return chapter;
    });
  }

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    const script = document.selectFirst("script:containsData(const pages)")!.data();
    const afterConst = script.includes("const pages = ") ? script.substring(script.indexOf("const pages = ") + "const pages = ".length) : script;
    const json = afterConst.includes(";") ? afterConst.substring(0, afterConst.indexOf(";")) : afterConst;
    return (JSON.parse(json) as Dto[]).map((it) => new Page(it.num - 1, "", it.url));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Note: Search and active filters are applied together"), new StatusFilter());
  }

  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }
  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }
  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }
}

class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(displayName, vals.map((it) => it[0]));
  }
  get value(): string {
    return this.vals[this.state][1];
  }
}

class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["All", ""],
      ["Ongoing", "Ongoing"],
      ["Completed", "Completed"],
      ["Hiatus", "Hiatus"],
    ]);
  }
}
