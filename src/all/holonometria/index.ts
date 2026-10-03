// Port of keiyoushi/extensions-source src/all/holonometria/Holonometria.kt
import { DateTimeFormatter, FilterList, GET, HttpSource, Locale, MangasPage, Page, SChapter, SManga, substringAfter, urlWithoutDomain, type Request, type Response } from "../../../sdk/index.ts";

const manga = ["manga", "gambar", "漫画"];
const script = ["script", "naskah", "脚本"];

const dateFormat = DateTimeFormatter.ofPattern("yyyy.MM.dd", Locale.ENGLISH);

export default class Holonometria extends HttpSource {
  private get langPath(): string {
    return this.lang === "ja" ? "" : `${this.lang}/`;
  }

  override get supportsLatest(): boolean {
    return false;
  }

  protected popularMangaRequest(_page: number): Request {
    return GET(`${this.baseUrl}/${this.langPath}alt/holonometria/manga/`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();

    const mangas = document.select(".manga__item").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
      manga.title = element.select(".manga__title").text();
      manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
      return manga;
    });

    return new MangasPage(mangas, false);
  }

  protected searchMangaRequest(_page: number, query: string, _filters: FilterList): Request {
    return GET(`${this.baseUrl}/${this.langPath}alt/holonometria/manga/#${query.trim()}`, this.headers);
  }

  // The search term travels in the request URL's fragment; the fetch layer drops it from response.url, so the query is passed in.
  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const response = await this.executeSuccess(await this.searchMangaRequest(page, query, filters));
    return this.parseSearch(response, query.trim());
  }

  protected searchMangaParse(response: Response): MangasPage {
    let fragment = "";
    try {
      fragment = decodeURIComponent(new URL(response.url).hash.slice(1));
    } catch {
      // keep ""
    }
    return this.parseSearch(response, fragment);
  }

  private parseSearch(response: Response, search: string): MangasPage {
    const document = response.asJsoup();

    const entries = document
      .select(".manga__item")
      .map((element) => {
        const manga = SManga.create();
        manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
        manga.title = element.select(".manga__title").text();
        manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
        return manga;
      })
      .filter((it) => it.title.toLowerCase().includes(search.toLowerCase()));

    return new MangasPage(entries, false);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();

    const details = SManga.create();
    details.title = document.select(".alt-nav__met-sub-link.is-current").text();
    details.thumbnail_url = document.select(".manga-detail__thumb img").attr("abs:src");
    details.description = document.select(".manga-detail__caption").text();

    const info = document.select(".manga-detail__person").html().split("<br>");

    const pick = (keys: string[]) => {
      const desc = info.find((d) => keys.some((k) => d.toLowerCase().includes(k.toLowerCase())));
      return desc == null ? undefined : substringAfter(substringAfter(desc, "："), ":").trim().replaceAll("&amp;", "&");
    };
    details.author = pick(manga);
    details.artist = pick(script);
    return details;
  }

  protected override chapterListRequest(manga: SManga): Request {
    return GET(`${this.baseUrl}/${manga.url}`, this.headers);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const document = response.asJsoup();

    return document
      .select(".manga-detail__list .manga-detail__list-item")
      .map((element) => {
        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
        chapter.name = element.select(".manga-detail__list-title").text();
        chapter.date_upload = dateFormat.tryParseDate(element.selectFirst(".manga-detail__list-date")?.text());
        return chapter;
      })
      .reverse();
  }

  protected pageListParse(response: Response): Page[] {
    const document = response.asJsoup();

    return document
      .select(".manga-detail__swiper-wrapper img")
      .map((img, idx) => new Page(idx, "", img.attr("abs:src")))
      .reverse();
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
