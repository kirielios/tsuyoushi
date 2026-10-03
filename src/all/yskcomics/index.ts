// Port of keiyoushi/extensions-source src/all/yskcomics/YSKComics.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, toHttpUrl, toHttpUrlOrNull, urlWithoutDomain } from "../../../sdk/index.ts";
import {
  chapterToSChapter, detailsToSManga, latestToSManga, popularToSManga, searchToSManga,
  type ChapterDto, type DetailsDto, type LatestDto, type PageDto, type PopularDto, type SearchDto,
} from "./dto.ts";

export default class YSKComics extends KeiSource {
  private readonly apiBaseUrl = "https://api.ysk-comics.com";

  protected override configureHeaders(headers: Headers): Headers {
    headers.set("x-localization", this.lang);
    return headers;
  }

  // ---

  async getPopularManga(_page: number): Promise<MangasPage> {
    const data = (await this.client.get(`${this.baseUrl}/api/home/best-comics`)).parseAs<PopularDto>().data;
    return new MangasPage(data.map((it) => popularToSManga(it, this.lang, this.host)), false);
  }

  // ---

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const data = (await this.client.get(`${this.baseUrl}/api/home/latest-comics?page=${page}`)).parseAs<LatestDto>().data;
    return new MangasPage(data.data_messages.map((it) => latestToSManga(it, this.lang)), data.meta.link_next != null);
  }

  // ---

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== toHttpUrl(this.baseUrl).host || url.pathname.split("/").filter((s) => s !== "")[0] !== this.lang) return null;

    const manga = SManga.create();
    manga.url = urlWithoutDomain(url.toString());

    return this.fetchMangaDetails(manga);
  }

  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    if (query.trim().length < 3) throw new Error("Search query must be at least 3 characters");

    const url = toHttpUrl(`${this.apiBaseUrl}/api/v1/search-comics-home`).newBuilder().addQueryParameter("name", query).build();

    const data = (await this.client.get(url.toString())).parseAs<SearchDto>().data;
    return new MangasPage(data.map((it) => searchToSManga(it, this.lang)), false);
  }

  // ---

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchMangaDetails(manga) : manga, fetchChapters ? this.fetchChapterList(manga) : chapters]);
    return new SMangaUpdate(details, chapterList);
  }

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const slug = this.extractSlug(manga.url);
    return detailsToSManga((await this.client.get(`${this.baseUrl}/api/comic/${slug}`)).parseAs<DetailsDto>().data, this.lang, this.host);
  }

  // ---

  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const slug = this.extractSlug(manga.url);
    const list: SChapter[] = [];
    let page = 1;
    let data: ChapterDto["data"];
    do {
      data = (await this.client.get(`${this.baseUrl}/api/comic/chapter/${slug}?page=${page}`)).parseAs<ChapterDto>().data;
      for (const it of data.data_messages) list.push(chapterToSChapter(it, this.lang));
      page++;
    } while (data.meta.link_next != null);
    return list.reverse();
  }

  // ---

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const slug = this.extractSlug(chapter.url);
    const data = (await this.client.get(`${this.baseUrl}/api/chapters/images/${slug}`)).parseAs<PageDto>().data;
    return data.map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  // ---

  private extractSlug(path: string): string {
    const url = `${this.baseUrl}${path}`;
    const segments = toHttpUrlOrNull(url)?.pathSegments;
    const last = segments?.[segments.length - 1];
    if (last === undefined) throw new Error(`Unable to parse URL:\n${url}`);
    return last;
  }
}
