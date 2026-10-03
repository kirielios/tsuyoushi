// Port of keiyoushi/extensions-source lib-multisrc/masonry/Masonry.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  isBlank,
  substringBefore,
  toHttpUrl,
  toJsonElement,
  urlWithoutDomain,
  type Document,
  type Element,
} from "../../sdk/index.ts";
import { SortFilter, TagFilter, type Tag } from "./filters.ts";

export abstract class Masonry extends KeiSource {
  protected popularMangaUrl(page: number): string {
    switch (page) {
      case 1:
        return this.baseUrl;
      case 2:
        return `${this.baseUrl}/archive/`;
      default:
        return `${this.baseUrl}/archive/page/${page - 1}/`;
    }
  }

  override async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.popularMangaUrl(page))).asJsoup();
    return this.parseMangaList(document);
  }

  protected parseMangaList(document: Document): MangasPage {
    const mangas = document.select(".list-gallery:not(.static) figure:not(:has(a[href*='/video/']))").map((element) => {
      const manga = SManga.create();
      const it = element.selectFirst("a")!;
      manga.url = urlWithoutDomain(it.absUrl("href"));
      manga.title = it.attr("title");
      manga.thumbnail_url = this.imgAttr(element.selectFirst("img")) ?? undefined;
      return manga;
    });
    const hasNextPage = document.selectFirst(".pagination-a li.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/updates/sort/newest/mpage/${page}/`)).asJsoup();
    return this.parseMangaList(document);
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let url;
    if (query.length > 0) {
      url = toHttpUrl(`${this.baseUrl}/search/post/`).newBuilder().addPathSegment(query.trim()).addEncodedPathSegments(`mpage/${page}/`).build();
    } else {
      const tagFilter = filters.find((f): f is TagFilter => f instanceof TagFilter);
      const sortFilter = filters.find((f): f is SortFilter => f instanceof SortFilter)!;

      const builder = toHttpUrl(this.baseUrl).newBuilder();
      let it: string;
      if (tagFilter == null || tagFilter.selected === "") {
        builder.addPathSegment("updates");
        it = sortFilter.getUriPartIfNeeded("search");
      } else {
        builder.addPathSegment("tag");
        builder.addPathSegment(tagFilter.selected);
        it = sortFilter.getUriPartIfNeeded("tag");
      }
      if (isBlank(it)) {
        builder.addEncodedPathSegments(`page/${page}/`);
      } else {
        builder.addEncodedPathSegments(it);
        builder.addEncodedPathSegments(`mpage/${page}/`);
      }
      url = builder.build();
    }

    const document = (await this.client.get(url.toString())).asJsoup();
    return this.parseMangaList(document);
  }

  /* Filters */

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const tags: Tag[] = (await this.client.get(`${this.baseUrl}/updates/sort/newest/`))
      .asJsoup()
      .select("#filter-a span:has(> input)")
      .map((it) => ({ name: it.select("label").text(), uriPart: it.select("input").attr("value") }));
    return toJsonElement([{ name: "", uriPart: "" }, ...tags]);
  }

  override getFilterList(data: unknown = null): FilterList {
    const filterData = data as Tag[] | null;

    const filters: Filter[] = [new Filter.Header("Filters ignored with text search"), new Filter.Separator(), new SortFilter()];

    if (filterData?.length) {
      filters.push(new TagFilter(filterData));
    }

    return FilterList(...filters);
  }

  /* Manga details & chapters */

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(document, manga), this.parseChapterList(document, manga));
  }

  protected parseMangaDetails(document: Document, _manga: SManga): SManga {
    const details = SManga.create();
    const p = document.selectFirst("p.link-btn");
    if (p) {
      details.artist = p.select("a[href*='/model/']").eachText().join(", ");
      details.genre = p.select("a[href*='/tag/']").eachText().join(", ");
      details.author = p.selectFirst("a")?.text();
    }
    details.description = document.selectFirst("#content > p")?.text();
    details.status = SManga.COMPLETED;
    // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: the SDK has no update strategy
    return details;
  }

  protected parseChapterList(_document: Document, manga: SManga): SChapter[] {
    const chapter = SChapter.create();
    chapter.name = "Gallery";
    chapter.url = manga.url;
    return [chapter];
  }

  /* Pages */
  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select(".list-gallery a[href^='https://cdn.']").map((img, idx) => new Page(idx, "", img.absUrl("href")));
  }

  protected imgAttr(element: Element | null): string | null {
    if (!element) return null;
    // Jsoup's abs: keeps the srcset descriptors; resolving after cutting them keeps that result here
    if (element.hasAttr("srcset")) return new URL(substringBefore(element.attr("srcset").trim(), " "), element.baseUri).href;
    if (element.hasAttr("data-cfsrc")) return element.attr("abs:data-cfsrc");
    if (element.hasAttr("data-src")) return element.attr("abs:data-src");
    if (element.hasAttr("data-lazy-src")) return element.attr("abs:data-lazy-src");
    return element.attr("abs:src");
  }
}
