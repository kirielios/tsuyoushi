// Port of keiyoushi/extensions-source src/en/likemanga/LikeManga.kt
import {
  Base64, DateTimeFormatter, Filter, FilterList, KeiSource, Locale, MangasPage, Page, SChapter, SManga, SMangaUpdate, fromUtf8, parseHtml, toHttpUrl, urlWithoutDomain,
  type ClientBuilder, type Element,
} from "../../../sdk/index.ts";
import { ChapterCountFilter, GenreFilter, SortFilter, StatusFilter } from "./filters.ts";

const THUMBNAIL = "thumb";
const dateFormat = DateTimeFormatter.ofPattern("MMMM dd, yyyy", Locale.ENGLISH);
const chapterPageCountRegex = /load_list_chapter\((\d+)\)/;

export default class LikeManga extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .rateLimit(1, 2000, (it) => it.searchParams.get("code") === "ajax" && it.searchParams.get("code") === "load_list_chapter") // sic: upstream's condition never holds
      .rateLimit(1, 1000, (it) => it.host === toHttpUrl(this.baseUrl).host && it.hash.replace(/^#/, "") !== THUMBNAIL);
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchManga(page, "", FilterList(new SortFilter("top-manga")));
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchManga(page, "", FilterList(new SortFilter("lastest-chap")));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== toHttpUrl(this.baseUrl).host) return null;

    const manga = SManga.create();
    manga.url = urlWithoutDomain(url.toString());
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(this.baseUrl).newBuilder();
    builder.addQueryParameter("act", "searchadvance");
    for (const filter of filters) {
      if (filter instanceof GenreFilter) {
        filter.checked?.forEach((it) => builder.addQueryParameter("f[genres][]", it));
      } else if (filter instanceof ChapterCountFilter) {
        if (filter.selected != null) builder.addQueryParameter("f[min_num_chapter]", filter.selected);
      } else if (filter instanceof StatusFilter) {
        if (filter.selected != null) builder.addQueryParameter("f[status]", filter.selected);
      } else if (filter instanceof SortFilter) {
        if (filter.selected != null) builder.addQueryParameter("f[sortby]", filter.selected);
      }
    }
    if (query.length > 0) builder.addQueryParameter("f[keyword]", query.trim());
    if (page > 1) builder.addQueryParameter("pageNum", String(page));

    const document = (await this.client.get(builder.build().toString())).asJsoup();

    const mangas = document.select("div.card-body div.card").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.attr("href"));
      const img = element.selectFirst("img");
      manga.thumbnail_url = img ? this.imgAttr(img, true) ?? undefined : undefined;
      manga.title = element.select(".title-manga").text();
      return manga;
    });
    const hasNextPage = document.selectFirst("ul.pagination a:contains(»)") != null;

    return new MangasPage(mangas, hasNextPage);
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<[string, string][]> {
    const document = (await this.client.get(`${this.baseUrl}/?act=searchadvance`)).asJsoup();

    const out: [string, string][] = [];
    for (const it of document.selectFirst("div.search_genres")?.select("div.form-check") ?? []) {
      const label = it.selectFirst("label")?.text();
      if (label == null) continue;
      const value = it.selectFirst("input")?.attr("value");
      if (value == null) continue;
      out.push([label, value]);
    }
    return out;
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new SortFilter(), new StatusFilter(), new ChapterCountFilter()];
    if (data != null) filters.push(new GenreFilter("Genre", data as [string, string][]));
    return FilterList(...filters);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    manga.title = document.select("#title-detail-manga").text();
    const cover = document.selectFirst(".detail-info img");
    manga.thumbnail_url = cover ? this.imgAttr(cover, true) ?? undefined : undefined;
    manga.description = document.selectFirst("#summary_shortened")?.text();
    manga.genre = document
      .select(".list-info a[href*=/genres/]")
      .map((it) => it.text())
      .join(", ");
    manga.status = this.parseStatus(document.selectFirst(".list-info .status p:nth-child(2)")?.text());
    const author = document.selectFirst(".list-info .author p:nth-child(2)")?.text();
    manga.author = author != null && author.trim() !== "Updating" ? author : undefined;
    const updatedManga = manga;

    const updatedChapters = document.select(".wp-manga-chapter").map((it) => this.chapterFromElement(it));

    const lastPage = Number.parseInt(chapterPageCountRegex.exec(document.select("div.chapters_pagination a:not(.next)").last()?.attr("onclick") ?? "")?.[1] ?? "", 10);
    if (Number.isNaN(lastPage)) return new SMangaUpdate(updatedManga, updatedChapters);

    if (fetchChapters) {
      const mangaId = document.select("#title-detail-manga").attr("data-manga");

      const pages = await Promise.all(
        Array.from({ length: Math.max(lastPage - 1, 0) }, (_, i) => i + 2).map(async (page) => {
          const url = toHttpUrl(this.baseUrl)
            .newBuilder()
            .addQueryParameter("act", "ajax")
            .addQueryParameter("code", "load_list_chapter")
            .addQueryParameter("manga_id", mangaId)
            .addQueryParameter("page_num", String(page))
            .addQueryParameter("chap_id", "0")
            .addQueryParameter("keyword", "")
            .build();

          const listChap = (await this.client.get(url.toString())).parseAs<{ list_chap: string }>().list_chap;
          return parseHtml(this.host.load, listChap, this.baseUrl)
            .select(".wp-manga-chapter")
            .map((it) => this.chapterFromElement(it));
        }),
      );

      return new SMangaUpdate(updatedManga, [...updatedChapters, ...pages.flat()]);
    }
    return new SMangaUpdate(updatedManga, chapters);
  }

  private parseStatus(s: string | null | undefined): number {
    if (s == null) return SManga.UNKNOWN;
    const l = s.toLowerCase();
    if (l.includes("complete")) return SManga.COMPLETED;
    if (l.includes("in process")) return SManga.ONGOING;
    if (l.includes("pause")) return SManga.ON_HIATUS;
    return SManga.UNKNOWN;
  }

  private chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.selectFirst("a")!.attr("href"));
    chapter.name = element.select("a").text();
    chapter.date_upload = dateFormat.tryParseDate(element.selectFirst(".chapter-release-date")?.text());
    return chapter;
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    return document.select("div:contains(you may also like) + div div.card > a").map((it) => {
      const m = SManga.create();
      m.url = urlWithoutDomain(it.absUrl("href"));
      const img = it.selectFirst("img")!;
      m.title = img.attr("alt");
      m.thumbnail_url = this.imgAttr(img, true) ?? undefined;
      return m;
    });
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const element = document.selectFirst("div.reading input#next_img_token");

    if (element != null) {
      const imgCdnUrl = document.selectFirst("div.reading #currentlink")?.attr("value");
      if (imgCdnUrl == null) throw new Error("Could not find image CDN URL");

      const token = element.attr("value").split(".")[1];
      const encodedImgArray = (JSON.parse(fromUtf8(Base64.decode(token))) as { data: string }).data;
      const imgArray = JSON.parse(fromUtf8(Base64.decode(encodedImgArray))) as string[];

      return imgArray.map((img, i) => new Page(i, "", `${imgCdnUrl}/${img}`));
    }

    return document.select("div.reading-detail.box_doc img:not(noscript img)").map((img, i) => new Page(i, "", this.imgAttr(img, false)!));
  }

  private imgAttr(element: Element, thumbnail: boolean): string | null {
    const img = element.attrOrNull("abs:data-cfsrc") ?? element.attrOrNull("abs:data-src") ?? element.attrOrNull("abs:data-lazy-src") ?? element.attrOrNull("abs:src");
    if (img == null) return null;
    return thumbnail ? toHttpUrl(img).newBuilder().fragment(THUMBNAIL).toString() : img;
  }
}
