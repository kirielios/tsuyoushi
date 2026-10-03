// Port of keiyoushi/extensions-source src/en/myhentaicomics/MyHentaiComics.kt
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, substringAfter, substringAfterLast, substringBefore, substringBeforeLast, urlWithoutDomain } from "../../../sdk/index.ts";
import { CategoryFilter, SortFilter } from "./filters.ts";

const encodeSpaces = (s: string) => s.replaceAll(" ", "%20");

export default class MyHentaiComics extends KeiSource {
  // =============================== Popular ================================

  // Popular = most viewed
  getPopularManga(page: number): Promise<MangasPage> {
    return this.parseComicListing(`${this.baseUrl}/views/${page}`);
  }

  // =============================== Latest =================================

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseComicListing(`${this.baseUrl}/gallery/${page}`);
  }

  // =============================== Search =================================

  getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const categoryFilter = firstInstanceOrNull(filters, CategoryFilter);
    const sortFilter = firstInstanceOrNull(filters, SortFilter);

    // Text search takes priority
    if (query.length > 0) {
      const url = new URL(`${this.baseUrl}/search/${page}`);
      url.searchParams.append("query", query);
      return this.parseComicListing(url.toString());
    }

    // Category filter
    if (categoryFilter != null && categoryFilter.toUriPart().length > 0) {
      const catId = categoryFilter.toUriPart();
      return this.parseComicListing(`${this.baseUrl}/gallery/category/${catId}/${page}`);
    }

    // Sort filter
    const sortPath = sortFilter?.toUriPart() ?? "gallery";
    return this.parseComicListing(`${this.baseUrl}/${sortPath}/${page}`);
  }

  // ============================== Filters =================================

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Note: Text search ignores all filters below"), new Filter.Separator(), new SortFilter(), new Filter.Separator(), new CategoryFilter());
  }

  // =========================== Comic Listing ==============================

  private async parseComicListing(url: string): Promise<MangasPage> {
    const document = (await this.client.get(url)).asJsoup();

    const mangas = document.select("li.item:not(.image-block) .comic-inner a").map((el) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(el.absUrl("href"));
      manga.title = el.select("h2.comic-name").text();
      const src = el.select("img").first()?.absUrl("src");
      manga.thumbnail_url = src != null ? encodeSpaces(src) : undefined;
      return manga;
    });

    const hasNextPage = document.selectFirst("li.next a") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // =========================== Manga Details ==============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const descriptionDiv = document.selectFirst("div.comic-description");

    const categories = descriptionDiv?.select("a[href*='/gallery/category/']").map((it) => it.text()) ?? [];
    const artists = descriptionDiv?.select("a[href*='/gallery/artist/']").map((it) => it.text()) ?? [];
    const groups = descriptionDiv?.select("a[href*='/gallery/group/']").map((it) => it.text()) ?? [];

    const pagesText = descriptionDiv
      ?.select("div")
      .find((it) => it.ownText().startsWith("Pages:"))
      ?.text();

    const updatedManga = manga;
    updatedManga.title = descriptionDiv?.selectFirst("h1")?.text() ?? updatedManga.title;
    const cover = document.selectFirst("div.comic-cover img")?.absUrl("src");
    updatedManga.thumbnail_url = cover != null ? encodeSpaces(cover) : undefined;
    updatedManga.genre = [...categories, ...artists, ...groups].join(", ");
    updatedManga.status = SManga.COMPLETED;
    let description = "";
    if (artists.length > 0) description += `Artists: ${artists.join(", ")}\n`;
    if (groups.length > 0) description += `Groups: ${groups.join(", ")}\n`;
    if (pagesText) description += pagesText;
    updatedManga.description = description.trimEnd();

    // Extract comic ID from the "Back to gallery" / first page link on the thumbnail page
    const firstPageHref = document.selectFirst("div.comic-cover a")?.absUrl("href");
    if (firstPageHref == null) return new SMangaUpdate(updatedManga, []);

    // href = "https://myhentaicomics.com/gallery/show/59109/1"
    const comicId = substringBefore(substringAfter(firstPageHref, "/gallery/show/"), "/");

    const chapter = SChapter.create();
    chapter.url = `/gallery/show/${comicId}/1`;
    chapter.name = "Chapter 1";
    chapter.chapter_number = 1;
    chapter.date_upload = 0;

    return new SMangaUpdate(updatedManga, [chapter]);
  }

  // ============================== Page List ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();

    // The comic ID from the request URL: /gallery/show/59109/1
    const comicId = substringBefore(substringAfter(document.location(), "/gallery/show/"), "/");

    // Get the current page image to derive folder and extension
    const imageUrl = document.selectFirst("ul.gallery-slide li img")?.absUrl("src");
    if (imageUrl == null) return [];

    // imageUrl = "https://cdn.myhentaicomics.com/mhc/images/The Mayor 6/original/001.jpg?22"
    const imageBase = `${substringBeforeLast(imageUrl, "/")}/`;
    const fileName = substringAfterLast(imageUrl, "/"); // "001.jpg?22"
    const fileExtension = substringAfter(fileName, "."); // "jpg?22"

    // Find total page count from all pagination links pointing to this comic
    const nums = document
      .select(`ul li a[href*='/gallery/show/${comicId}/']`)
      .map((it) => substringAfterLast(it.attr("href"), "/"))
      .filter((s) => /^[+-]?\d+$/.test(s))
      .map((s) => Number.parseInt(s, 10));
    const totalPages = nums.length > 0 ? Math.max(...nums) : 1;

    return Array.from({ length: totalPages }, (_, index) => new Page(index, "", encodeSpaces(`${imageBase}${String(index + 1).padStart(3, "0")}.${fileExtension}`)));
  }
}
