// Port of keiyoushi/extensions-source src/all/mangatoon/MangaToon.kt (+ EpisodeDto.kt)
import {
  DateTimeFormatter,
  HttpUrl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  parseAs,
  substringAfter,
  substringBeforeLast,
  urlWithoutDomain,
  type ClientBuilder,
  type Document,
  type Element,
  type Elements,
  type FilterList,
  type Response,
} from "../../../sdk/index.ts";

// ---- EpisodeDto.kt
interface EpisodeDto {
  id: number;
  title: string;
  weight: number;
  open_at?: string | null;
  is_fee?: boolean;
}

const ONGOING_STATUS = ["连载", "on going", "sedang berlangsung", "tiếp tục cập nhật", "en proceso", "atualizando", "เซเรียล", "en cours", "連載中"];
const COMPLETED_STATUS = ["完结", "completed", "tamat", "đã full", "terminada", "concluído", "จบ", "fin"];
const DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US);
const POSTER_SUFFIX = /(jpg)-poster(.*)\d+?$/g;
const EPISODES_REGEX = /data = JSON\.parse\('(.*)'\);/;
const JS_ESCAPE_REGEX = /\\(["'])/g;

export default class MangaToon extends KeiSource {
  private get urlLang(): string {
    return this.lang === "zh" ? "cn" : this.lang === "pt-BR" ? "pt" : this.lang;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(1, 1000);
  }

  private get locale() {
    return Locale.forLanguageTag(this.lang);
  }

  private get lockedError() {
    return this.lang === "pt-BR"
      ? "Este capítulo é pago e não pode ser lido. " + "Use o app oficial do MangaToon para comprar e ler."
      : "This chapter is paid and can't be read. " + "Use the MangaToon official app to purchase and read it.";
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    // Portuguese website doesn't seem to have popular titles.
    const path = this.lang === "pt-BR" ? "comic" : "hot";
    return this.mangaListParse(await this.client.get(`${this.baseUrl}/${this.urlLang}/genre/${path}?type=1&page=${page - 1}`));
  }

  private mangaListParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("div.genre-content div.items a").map((it) => this.mangaFromElement(it));
    const hasNextPage = document.selectFirst("span.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.mangaListParse(await this.client.get(`${this.baseUrl}/${this.urlLang}/genre/new?type=1&page=${page - 1}`));
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const searchUrl = HttpUrl.parse(`${this.baseUrl}/${this.urlLang}/search`).newBuilder().addQueryParameter("word", query).build();
    const document = (await this.client.get(searchUrl.toString())).asJsoup();
    // div.recommend-item:has(a[abs:href^=$baseUrl])
    const mangas = document
      .select("div.comics-result div.recommend-item")
      .filter((el) => el.select("a").some((a) => a.absUrl("href").startsWith(this.baseUrl)))
      .map((element) => {
        const manga = SManga.create();
        manga.title = element.select("div.recommend-comics-title").text();
        manga.thumbnail_url = this.toNormalPosterUrl(this.imgAttrs(element.select("img")));
        manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
        return manga;
      });
    const hasNextPage = document.selectFirst("span.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.title = element.select("div.content-title").text();
    manga.thumbnail_url = this.toNormalPosterUrl(this.imgAttrs(element.select("img")));
    manga.url = urlWithoutDomain(element.absUrl("href"));
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.mangaDetailsParse(manga, document), this.chapterListParse(document));
  }

  private mangaDetailsParse(manga: SManga, document: Document): SManga {
    const details = SManga.create();
    details.title = manga.title;
    details.author = substringAfter(document.select("div.detail-author-name span").text(), ": ");
    details.description = document
      .select("div.detail-description-short p")
      .map((it) => it.text())
      .join("\n\n");
    details.genre = document
      .select("div.detail-tags-info span")
      .text()
      .split("/")
      .map((it) => (it.length ? it[0].toLocaleUpperCase(this.locale.tag) + it.slice(1) : it))
      .sort()
      .map((it) => it.trim())
      .join(", ");
    details.status = this.toStatus(document.select("div.detail-status").text());
    const thumbnail = this.toNormalPosterUrl(this.imgAttrs(document.select("div.detail-img img")));
    if (!thumbnail.includes("cartoon-big-images")) details.thumbnail_url = thumbnail;
    return details;
  }

  // The page only renders a few episodes; the full list (with paid flags) is embedded as JSON.
  private chapterListParse(document: Document): SChapter[] {
    const href = document.selectFirst("a.episode-item-new")?.attr("href");
    if (href === undefined) return [];
    const watchPath = substringBeforeLast(href, "/");
    let json: string | undefined;
    for (const script of document.select("script")) {
      const m = EPISODES_REGEX.exec(script.data());
      if (m) {
        json = m[1];
        break;
      }
    }
    const episodes = json !== undefined ? (parseAs<EpisodeDto[] | null>(json.replace(JS_ESCAPE_REGEX, "$1")) ?? []) : [];

    return episodes
      .filter((it) => !(it.is_fee ?? false))
      .map((it) => {
        const chapter = SChapter.create();
        chapter.name = it.title;
        chapter.chapter_number = it.weight;
        chapter.date_upload = DATE_FORMAT.tryParseDate(it.open_at);
        chapter.url = urlWithoutDomain(`${watchPath}/${it.id}`);
        return chapter;
      })
      .reverse();
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageListParse((await this.client.get(this.getChapterUrl(chapter))).asJsoup());
  }

  private pageListParse(document: Document): Page[] {
    const pages = document.select("div.pictures div img:first-child").map((element, i) => new Page(i, "", this.imgAttr(element)));
    if (pages.length === 0) throw new Error(this.lockedError);
    return pages;
  }

  private imgAttr(element: Element): string {
    return element.hasAttr("data-src") ? element.attr("abs:data-src") : element.attr("abs:src");
  }

  /** Elements.imgAttr(): the first element's */
  private imgAttrs(elements: Elements): string {
    return this.imgAttr(elements.first()!);
  }

  private toNormalPosterUrl(s: string): string {
    return s.replace(POSTER_SUFFIX, "$1");
  }

  private toStatus(s: string): number {
    const l = s.toLocaleLowerCase(this.locale.tag);
    return ONGOING_STATUS.includes(l) ? SManga.ONGOING : COMPLETED_STATUS.includes(l) ? SManga.COMPLETED : SManga.UNKNOWN;
  }
}
