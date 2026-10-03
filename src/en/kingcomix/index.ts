// Port of keiyoushi/extensions-source src/en/kingcomix/KingComiX.kt
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, toHttpUrl, tryParseInstant, urlWithoutDomain, type Document } from "../../../sdk/index.ts";
import { CategoryFilter, TagFilter } from "./filters.ts";

export default class KingComiX extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  // ============================== Popular ===============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    if (page > 1) {
      url.addPathSegment("page");
      url.addPathSegment(String(page));
    }
    url.addPathSegment(""); // Adds trailing slash natively
    const document = (await this.client.get(url.build().toString())).asJsoup();

    return this.parseFilteredManga(document, page);
  }

  // =============================== Latest ===============================

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("Unsupported operation");
  }

  // =============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();

    if (query.trim()) {
      url.addQueryParameter("s", query);
    } else {
      const category = firstInstanceOrNull(filters, CategoryFilter)?.toUriPart() ?? "";
      const tag = firstInstanceOrNull(filters, TagFilter)?.toUriPart() ?? "";

      // Ensure categories and tags are not mixed. Defaulting to category if both are picked.
      if (category.trim()) {
        url.addPathSegment("category");
        url.addPathSegment(category);
      } else if (tag.trim()) {
        url.addPathSegment("tag");
        url.addPathSegment(tag);
      }
    }
    if (page > 1) {
      url.addPathSegment("page");
      url.addPathSegment(String(page));
    }
    url.addPathSegment(""); // Adds trailing slash natively

    const document = (await this.client.get(url.build().toString())).asJsoup();
    return this.parseFilteredManga(document, page);
  }

  private parseFilteredManga(document: Document, page: number): MangasPage {
    const mangas = document.select("div.entry, article.thumb-block").map((element) => {
      const manga = SManga.create();
      const a = element.selectFirst("h2.information a, a[title]")!;

      manga.title = a.text() || a.attr("title");
      manga.url = urlWithoutDomain(a.absUrl("href"));

      const img = element.selectFirst("img");
      manga.thumbnail_url = img ? img.attr("abs:data-src") || img.attr("abs:src") : undefined;
      return manga;
    });

    const hasNextPage = document
      .select(".pagination a")
      .map((it) => (/^[+-]?\d+$/.test(it.text()) ? Number(it.text()) : null))
      .some((it) => it !== null && it > page);

    return new MangasPage(mangas, hasNextPage);
  }

  // =============================== Filters ==============================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("Text search ignores filters."),
      new Filter.Header("Select EITHER a Category OR a Tag."),
      new Filter.Header("If both are selected, Category takes priority."),
      new Filter.Separator(),
      new CategoryFilter(),
      new TagFilter(),
    );
  }

  // =========================== Manga Update ============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const url = this.baseUrl + manga.url;
    const document = (await this.client.get(url)).asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document), this.parseChapterList(document, url));
  }

  private parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst("h1.singleTitle-h1, h1.widget-title")!.text();
    manga.author = document.selectFirst("meta[name=author]")?.attr("content");

    const tags = document.select(".caTotal .tagsPost a.taxLink").map((it) => it.text());
    manga.genre = tags.join(", ");

    manga.thumbnail_url = document.selectFirst("meta[property=og:image]")?.attr("content") ?? document.selectFirst(".entry-content img")?.attr("abs:src");

    manga.status = SManga.COMPLETED;
    // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: SManga has no update strategy here
    return manga;
  }

  private parseChapterList(document: Document, url: string): SChapter[] {
    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.url = urlWithoutDomain(url);
    chapter.date_upload = tryParseInstant(document.selectFirst("meta[property=article:published_time]")?.attr("content"));
    return [chapter];
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();

    return document.select(".entry-content img").map((img, i) => {
      const url = img.attr("abs:data-src") || img.attr("abs:src");
      return new Page(i, "", url);
    });
  }
}
