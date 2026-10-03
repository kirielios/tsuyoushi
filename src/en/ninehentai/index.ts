// Port of keiyoushi/extensions-source src/en/ninehentai/NineHentai.kt (+ Dto.kt)
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, ago, firstInstanceOrNull, substringAfter, substringBefore, toHttpUrl, isNotBlank, type Element } from "../../../sdk/index.ts";

// Dto.kt
interface Manga {
  id: number;
  total_page: number;
  title: string;
}
interface Tag {
  id: number;
  name: string;
  type?: number;
}
interface SearchResponse {
  total_count: number;
  results: Manga[];
}

const SEARCH_URL = "/api/getBook";
const MANGA_URL = "/api/getBookByID";
const TAG_URL = "/api/getTag";

class SortFilter extends Filter.Select<string> {
  constructor() {
    super("Sort by", ["Newest", "Popular Right now", "Most Fapped", "Most Viewed", "By Title"]);
  }
}
class MinPagesFilter extends Filter.Text {
  constructor() {
    super("Minimum Pages");
  }
}
class MaxPagesFilter extends Filter.Text {
  constructor() {
    super("Maximum Pages");
  }
}
class IncludedFilter extends Filter.Text {
  constructor() {
    super("Included Tags");
  }
}
class ExcludedFilter extends Filter.Text {
  constructor() {
    super("Excluded Tags");
  }
}
class ArtistFilter extends Filter.Text {
  constructor() {
    super("Artist");
  }
}
class GroupFilter extends Filter.Text {
  constructor() {
    super("Group");
  }
}
class ParodyFilter extends Filter.Text {
  constructor() {
    super("Parody");
  }
}
class CharacterFilter extends Filter.Text {
  constructor() {
    super("Character");
  }
}
class CategoryFilter extends Filter.Text {
  constructor() {
    super("Category");
  }
}

export default class NineHentai extends KeiSource {
  // The API's image_server still points old galleries at the dead i.9hentai.com host
  private get imageBaseUrl(): string {
    return `https://i.${toHttpUrl(this.baseUrl).host}/images`;
  }

  private coverUrl(id: number) {
    return `${this.imageBaseUrl}/${id}/cover.jpg`;
  }

  private toSManga(m: Manga, thumbnail: string): SManga {
    const manga = SManga.create();
    manga.url = `/g/${m.id}`;
    manga.title = m.title;
    manga.thumbnail_url = thumbnail;
    return manga;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const headers = new Headers(this.headers);
    headers.set("Content-Type", "application/json");
    return (await this.client.post(`${this.baseUrl}${path}`, headers, JSON.stringify(body))).parseAs<T>();
  }

  // ============================== Popular ==============================
  getPopularManga(page: number): Promise<MangasPage> {
    return this.search({ page, sort: 1 });
  }

  // ============================== Latest ===============================
  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.search({ page });
  }

  // ============================== Search ===============================
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== toHttpUrl(this.baseUrl).host) return null;
    const id = this.toIntOrNull(url.pathname.slice(1).split("/")[1]);
    if (id === null) return null;
    const m = await this.fetchMangaById(id);
    return this.toSManga(m, this.coverUrl(m.id));
  }

  private toIntOrNull(s: string | undefined): number | null {
    return s !== undefined && /^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("id:")) {
      const id = this.toIntOrNull(substringAfter(query, "id:"));
      if (id === null) return new MangasPage([], false);
      const m = await this.fetchMangaById(id);
      return new MangasPage([this.toSManga(m, this.coverUrl(m.id))], false);
    }

    const sort = firstInstanceOrNull(filters, SortFilter)?.state ?? 0;
    const minPages = this.toIntOrNull(firstInstanceOrNull(filters, MinPagesFilter)?.state) ?? 0;
    const maxPages = this.toIntOrNull(firstInstanceOrNull(filters, MaxPagesFilter)?.state) ?? 2000;

    const includedTags: Tag[] = [];
    const excludedTags: Tag[] = [];

    const text = async (cls: abstract new (...a: never[]) => Filter<string>, type: number, into: Tag[]) => {
      const s = firstInstanceOrNull(filters, cls as never as abstract new () => Filter<string>)?.state;
      if (s && isNotBlank(s)) into.push(...(await this.getTags(s, type)));
    };
    await text(IncludedFilter, 1, includedTags);
    await text(ExcludedFilter, 1, excludedTags);
    await text(GroupFilter, 2, includedTags);
    await text(ParodyFilter, 3, includedTags);
    await text(ArtistFilter, 4, includedTags);
    await text(CharacterFilter, 5, includedTags);
    await text(CategoryFilter, 6, includedTags);

    return this.search({ searchText: query, page, sort, range: [minPages, maxPages], includedTags, excludedTags });
  }

  // ============================== Details ==============================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.getMangaUrl(manga));
    const path = new URL(response.url).pathname;
    const document = response.asJsoup();

    const info = document.selectFirst("div#bigcontainer");
    if (info) {
      manga.title = info.select("h1").text();
      const id = this.toIntOrNull(substringBefore(substringAfter(manga.url, "/g/"), "/"));
      manga.thumbnail_url = id !== null ? this.coverUrl(id) : manga.thumbnail_url;
      manga.status = SManga.COMPLETED;
      manga.artist = this.selectTextOrNull(info, "div.field-name:contains(Artist:) a.tag") ?? undefined;
      manga.author = this.selectTextOrNull(info, "div.field-name:contains(Group:) a.tag") ?? "Unknown circle";
      manga.genre = this.selectTextOrNull(info, "div.field-name:contains(Tag:) a.tag") ?? undefined;

      let description = "";
      let t: string | null;
      if ((t = this.selectTextOrNull(info, "h2"))) description += `Alternative Title: ${t}\n\n`;
      if ((t = this.selectTextOrNull(info, "div#info > div:contains(pages)"))) description += `Pages: ${t}\n\n`;
      if ((t = this.selectTextOrNull(info, "div.field-name:contains(Parody:) a.tag"))) description += `Parody: ${t}\n\n`;
      if ((t = this.selectTextOrNull(info, "div.field-name:contains(Category:) a.tag"))) description += `Category: ${t}\n\n`;
      if ((t = this.selectTextOrNull(info, "div.field-name:contains(Language:) a.tag"))) description += `Language: ${t}`;
      manga.description = description.trim();
    }

    const time = document.select("div#info div time").text();
    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.date_upload = this.parseChapterDate(time);
    chapter.url = path;

    return new SMangaUpdate(manga, [chapter]);
  }

  // =============================== Pages ===============================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const mangaId = Number.parseInt(substringBefore(substringAfter(chapter.url, "/g/"), "/"), 10);
    if (Number.isNaN(mangaId)) throw new Error("NumberFormatException");
    const imageUrl = `${this.imageBaseUrl}/${mangaId}`;
    let totalPages = (await this.fetchMangaById(mangaId)).total_page;

    const response = await this.client.get(`${imageUrl}/preview/${totalPages}t.jpg`, undefined, { ensureSuccess: false });
    if (response.code === 404) totalPages--;

    return Array.from({ length: totalPages }, (_, i) => new Page(i, "", `${imageUrl}/${i + 1}.jpg`));
  }

  // ============================== Filters ==============================
  getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header('Search by id with "id:" in front of query'),
      new Filter.Separator(),
      new SortFilter(),
      new MinPagesFilter(),
      new MaxPagesFilter(),
      new IncludedFilter(),
      new ExcludedFilter(),
      new ArtistFilter(),
      new GroupFilter(),
      new ParodyFilter(),
      new CharacterFilter(),
      new CategoryFilter(),
    );
  }

  // ============================= Utilities =============================
  private async search(o: { searchText?: string; page: number; sort?: number; range?: number[]; includedTags?: Tag[]; excludedTags?: Tag[] }): Promise<MangasPage> {
    const { searchText = "", page, sort = 0, range = [0, 2000], includedTags = [], excludedTags = [] } = o;
    const payload = {
      search: {
        text: searchText,
        page: page - 1, // Source starts counting from 0, not 1
        sort,
        pages: { range },
        tag: { items: { included: includedTags, excluded: excludedTags } },
      },
    };
    const searchResponse = await this.postJson<SearchResponse>(SEARCH_URL, payload);
    const mangas = searchResponse.results.map((it) => this.toSManga(it, this.coverUrl(it.id)));
    return new MangasPage(mangas, searchResponse.total_count > page);
  }

  private async fetchMangaById(id: number): Promise<Manga> {
    return (await this.postJson<{ results: Manga }>(MANGA_URL, { id })).results;
  }

  private selectTextOrNull(element: Element, selector: string): string | null {
    const list = element.select(selector);
    return list.length === 0 ? null : list.map((it) => it.text()).join(", ");
  }

  private parseChapterDate(date: string): number {
    const split = date.split(" ");
    const value = this.toIntOrNull(split[0]);
    if (value === null) return 0;
    const unit = split[1]?.replace(/s$/, "");
    switch (unit) {
      case "sec":
        return ago(value, "seconds");
      case "min":
        return ago(value, "minutes");
      case "hour":
        return ago(value, "hours");
      case "day":
        return ago(value, "days");
      case "week":
        return ago(value, "weeks");
      case "month":
        return ago(value, "months");
      case "year":
        return ago(value, "years");
      default:
        return 0;
    }
  }

  private async getTags(queries: string, type: number): Promise<Tag[]> {
    const out: Tag[] = [];
    for (const query of queries.split(",").map((s) => s.trim()).filter((s) => s.length > 0)) {
      const res = await this.postJson<{ results: Tag[] }>(TAG_URL, { tag_name: query, tag_type: type });
      if (res.results[0]) out.push(res.results[0]);
    }
    return out;
  }
}
