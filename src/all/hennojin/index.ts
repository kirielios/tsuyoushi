// Port of keiyoushi/extensions-source src/all/hennojin/Hennojin.kt
import {
  DateTimeFormatter,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  parseHtml,
  toHttpUrl,
  toHttpUrlOrNull,
  urlWithoutDomain,
  type FilterList,
  type HttpUrlBuilder,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

// Let's hope this doesn't change
const WP_NONCE = "40229f97a5";

const httpDate = DateTimeFormatter.ofPattern("EEE, dd MMM yyyy HH:mm:ss 'GMT'", Locale.ENGLISH);

export default class Hennojin extends HttpSource {
  // Popular is latest
  override get supportsLatest() {
    return false;
  }

  private get httpUrl() {
    return toHttpUrl(`${this.baseUrl}/home`);
  }

  protected latestUpdatesRequest(page: number): Request {
    return this.popularMangaRequest(page);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected popularMangaRequest(page: number): Request {
    return this.request((b) => {
      if (this.lang === "ja") {
        b.addEncodedPathSegments(`page/${page}/`);
        b.addQueryParameter("archive", "raw");
      } else b.addEncodedPathSegments(`page/${page}`);
      return b;
    });
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(".grid-items .layer-content").map((element) => {
      const manga = SManga.create();
      const it = element.selectFirst(".title_link > a");
      if (it) {
        manga.title = it.text();
        manga.url = urlWithoutDomain(it.absUrl("href"));
      }
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
      return manga;
    });
    const hasNextPage = document.selectFirst(".paginate .next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  protected searchMangaRequest(page: number, query: string, _filters: FilterList): Request {
    return this.request((b) => {
      b.addEncodedPathSegments(`page/${page}`);
      b.addQueryParameter("keyword", query);
      b.addQueryParameter("_wpnonce", WP_NONCE);
      return b;
    });
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();
    manga.description = document
      .select(".manga-subtitle + p + p")
      .map((it) => {
        // select("br").prepend("\\n"): a literal backslash-n before every <br>, then turned into real line breaks
        const withBreaks = parseHtml(this.host.load, it.outerHtml().replace(/<br\s*\/?>/gi, "\\n<br>"), "");
        return withBreaks.text().replaceAll("\\n", "\n").replaceAll("\n ", "\n");
      })
      .join("\n");
    manga.genre = document
      .select(".tags-list a[href*=/parody/]," + ".tags-list a[href*=/tags/]," + ".tags-list a[href*=/character/]")
      .map((it) => it.text())
      .join(", ");
    manga.artist = document.selectFirst(".tags-list a[href*=/artist/]")?.text();
    manga.author = document.selectFirst(".tags-list a[href*=/group/]")?.text() ?? manga.artist;
    manga.status = SManga.COMPLETED;
    return manga;
  }

  protected override async chapterListParse(response: Response): Promise<SChapter[]> {
    const document = response.asJsoup();
    const thumb = document.selectFirst(".manga-thumbnail > img")?.absUrl("src");
    let date: number | undefined;
    if (thumb) {
      const head = await this.client.head(thumb, undefined, { ensureSuccess: false });
      const lastModified = head.header("Last-Modified");
      date = lastModified != null ? httpDate.tryParseDateTime(lastModified) : 0;
    }

    return document.select("a:contains(Read Online)").map((it) => {
      const chapter = SChapter.create();
      const href = it.absUrl("href");
      const parsed = toHttpUrlOrNull(href);
      chapter.url = urlWithoutDomain(parsed != null ? parsed.newBuilder().removeAllQueryParameters("view").addQueryParameter("view", "multi").build().toString() : href);
      chapter.name = "Chapter";
      if (date != null) chapter.date_upload = date;
      chapter.chapter_number = -1;
      return chapter;
    });
  }

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();
    return document.select(".slideshow-container > img").map((img, idx) => new Page(idx, "", img.absUrl("src")));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  private request(block: (b: HttpUrlBuilder) => HttpUrlBuilder): Request {
    return GET(block(this.httpUrl.newBuilder()).build(), this.headers);
  }
}
