// Port of keiyoushi/extensions-source src/en/mlbblore/MLBBLore.kt (+ Dto.kt)
import { KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, type FilterList } from "../../../sdk/index.ts";

// type=3 from API payload; represents comic albums
const TYPE_COMIC = 3;

const SORT_NEWEST = 1;
const SORT_POPULARITY = 3;

interface AlbumEntry {
  id?: number;
  type?: number;
  title?: string;
  hero_name?: string;
  thumb?: string;
}

interface AlbumDetail {
  id?: number;
  title?: string;
  hero_name?: string;
  thumb?: string;
  share_content?: string;
  comic_content?: string[];
}

interface ApiListResponse {
  data?: AlbumEntry[];
}

interface ApiDetailResponse {
  data?: AlbumDetail | null;
}

const toAbsoluteUrl = (s: string) => (s.startsWith("//") ? `https:${s}` : s);

const entryToSManga = (e: AlbumEntry): SManga => {
  const manga = SManga.create();
  manga.url = String(e.id ?? 0);
  manga.title = e.title ?? "";
  manga.author = (e.hero_name ?? "").trim();
  manga.thumbnail_url = toAbsoluteUrl(e.thumb ?? "");
  return manga;
};

const detailToSManga = (d: AlbumDetail): SManga => {
  const manga = SManga.create();
  manga.title = d.title ?? "";
  manga.author = (d.hero_name ?? "").trim();
  manga.thumbnail_url = toAbsoluteUrl(d.thumb ?? "");
  manga.description = d.share_content ?? "";
  manga.status = SManga.COMPLETED;
  manga.initialized = true;
  return manga;
};

const detailToSChapter = (d: AlbumDetail): SChapter => {
  const chapter = SChapter.create();
  chapter.name = "Chapter 1";
  chapter.chapter_number = 1;
  chapter.url = String(d.id ?? 0);
  return chapter;
};

const detailToPageList = (d: AlbumDetail): Page[] => (d.comic_content ?? []).map((raw, index) => new Page(index, "", toAbsoluteUrl(raw)));

export default class MLBBLore extends KeiSource {
  private readonly apiUrl = "https://api.mobilelegends.com";
  private readonly pageSize = 5;

  private async fetchDetail(id: string): Promise<AlbumDetail | null> {
    const body = new URLSearchParams({ id, lang: "en", token: "" });

    return (await this.client.post(`${this.apiUrl}/lore/album/detail`, undefined, body)).parseAs<ApiDetailResponse>().data ?? null;
  }

  private async fetchMangaList(page: number, sort: number): Promise<MangasPage> {
    const body = new URLSearchParams({ type: String(TYPE_COMIC), sort: String(sort), page: String(page), page_size: String(this.pageSize), lang: "en", token: "" });

    const result = (await this.client.post(`${this.apiUrl}/lore/album/list`, undefined, body)).parseAs<ApiListResponse>();
    const data = result.data ?? [];
    const mangas = data.filter((it) => (it.type ?? 0) === TYPE_COMIC).map(entryToSManga);
    return new MangasPage(mangas, data.length >= this.pageSize);
  }

  getPopularManga(page: number): Promise<MangasPage> {
    return this.fetchMangaList(page, SORT_POPULARITY);
  }

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.fetchMangaList(page, SORT_NEWEST);
  }

  getSearchMangaList(page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return this.getPopularManga(page);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const detail = await this.fetchDetail(manga.url);
    if (detail == null) return new SMangaUpdate(manga, []);

    const details = detailToSManga(detail);
    details.url = manga.url;
    return new SMangaUpdate(details, [detailToSChapter(detail)]);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const detail = await this.fetchDetail(chapter.url);
    return detail ? detailToPageList(detail) : [];
  }
}
