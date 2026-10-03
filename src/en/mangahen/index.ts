// Port of keiyoushi/extensions-source src/en/mangahen/Gensura.kt (+ Filters.kt)
import {
  Filter,
  FilterList,
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  isBlank,
  urlWithoutDomain,
  type Element,
  type Response,
} from "../../../sdk/index.ts";

// ---- Filters.kt
class TextFilter extends Filter.Text {}
class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly vals: [string, string][],
    state = 0,
  ) {
    super(
      name,
      vals.map((it) => it[0]),
      state,
    );
  }
  getValue() {
    return this.vals[this.state][1];
  }
}
class SortFilter extends SelectFilter {}
class TypeFilter extends SelectFilter {}

const getTypesList: [string, string][] = [
  ["All", "0"],
  ["Manga", "1"],
  ["Doujinshi", "2"],
];
const getSortsList: [string, string][] = [
  ["Newest", "2"],
  ["Popular", "1"],
  ["Relevance", "0"],
  ["Best Rated", "3"],
  ["Most Viewed", "4"],
];
const getFilters = (): FilterList =>
  FilterList(
    new SortFilter("Sort by", getSortsList),
    new TypeFilter("Types", getTypesList),
    new Filter.Separator(),
    new Filter.Header("Separate tags with commas (,)"),
    new Filter.Header("Prepend with dash (-) to exclude"),
    new TextFilter("Tags"),
  );

export default class Gensura extends KeiSource {
  private get advSearchURL() {
    return `${this.baseUrl}/advanced-search`;
  }

  private _tagsList = new Map<string, string>();

  // Popular
  async getPopularManga(page: number): Promise<MangasPage> {
    return this.toMangasPage(await this.client.get(`${this.advSearchURL}/?search=1&type=0&sort=1&page=${page}`));
  }

  private toMangasPage(response: Response): MangasPage {
    const doc = response.asJsoup();
    const mangas = doc.select("a[href^=/manga/]").map((it) => this.popularMangaFromElement(it));
    const hasNextPage = doc.select("a[href*=page]").some((it) => isBlank(it.text()));
    return new MangasPage(mangas, hasNextPage);
  }

  private popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.title = element.selectFirst("h2")!.ownText();
    manga.url = urlWithoutDomain(element.absUrl("href"));
    manga.thumbnail_url = element.selectFirst("img")!.absUrl("src");
    return manga;
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.toMangasPage(await this.client.get(`${this.advSearchURL}/?search=1&type=0&sort=2&page=${page}`));
  }

  // Search
  private async tagsList(): Promise<Map<string, string>> {
    if (this._tagsList.size === 0) {
      const doc = (await this.client.get(`${this.advSearchURL}/`)).asJsoup();
      this._tagsList = new Map(doc.select("li[onclick=updateTag(this)]").map((it) => [it.ownText().toLowerCase(), it.attr("data-value")] as [string, string]));
    }
    return this._tagsList;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const includeTags: string[] = [];
    const excludeTags: string[] = [];

    const tagsList = await this.tagsList();
    // Without the trailing slash the site ignores all search parameters
    const b = HttpUrl.parse(`${this.advSearchURL}/`).newBuilder();
    for (const it of filters) {
      if (it instanceof SortFilter) b.addQueryParameter("sort", it.getValue());
      else if (it instanceof TypeFilter) b.addQueryParameter("type", it.getValue());
      else if (it instanceof TextFilter) {
        if (it.state.length > 0) {
          for (const tag of it.state.split(",").filter((t) => !isBlank(t))) {
            const trimmed = tag.trim().toLowerCase();
            if (trimmed.startsWith("-")) {
              const tagInfo = tagsList.get(trimmed.slice(1).trim());
              if (tagInfo !== undefined) excludeTags.push(tagInfo);
            } else {
              const tagInfo = tagsList.get(trimmed);
              if (tagInfo !== undefined) includeTags.push(tagInfo);
            }
          }
        }
      }
    }

    b.addQueryParameter("name", query);
    b.addQueryParameter("search", "1");
    if (includeTags.length > 0) b.addQueryParameter("include_tags", includeTags.join(","));
    if (excludeTags.length > 0) b.addQueryParameter("exclude_tags", excludeTags.join(","));
    if (page > 1) b.addQueryParameter("page", String(page));

    return this.toMangasPage(await this.client.get(b.build().toString()));
  }

  // Details
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? await this.mangaDetails(manga) : manga;

    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.url = urlWithoutDomain(manga.url);
    return new SMangaUpdate(details, [chapter]);
  }

  private async mangaDetails(manga: SManga): Promise<SManga> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const result = SManga.create();
    const authors = document.select("a[href*=/circles/]").eachText().join(", ");
    const artists = document.select("a[href*=/authors/]").eachText().join(", ");
    const titles = document.select("h1.font-semibold").text().split(" | ");
    const altit = document.select("h2.text-lg.font-medium").text();
    result.title = titles[0];
    result.author = authors || artists;
    result.artist = artists;
    result.genre = document.select("a[href*=/tags/]").eachText().join(", ");
    let description = "";
    if (titles.length > 1) {
      description += `Alternative Titles: \n- ${titles[1]}\n`;
      if (!isBlank(altit)) description += `- ${altit}\n`;
      description += "\n";
    }
    description += `Categories: ${document.select("a[href*=/categories/]").text()}\n`;
    description += `Parodies: ${document.select("a[href*=/parodies/]").text()}\n`;
    description += `Circles: ${document.select("a[href*=/circles/]").text()}\n\n`;
    description += `${document.select("tr:contains(page)").text()}\n`;
    description += `${document.select("tr:contains(view)").text()}\n`;
    result.description = description;
    result.thumbnail_url = document.selectFirst("img[src*=thumbnail].w-96")?.absUrl("src");
    result.status = SManga.COMPLETED;
    return result;
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const images = (await this.client.get(this.getChapterUrl(chapter))).asJsoup().select("img[src*=images]:not(img[src*=thumbnail]).w-full, img[data-src*=images]");
    return images.map((img, index) => {
      const image = img.absUrl("src") || img.absUrl("data-src");
      return new Page(index, "", image.replace(/-t(?=\.)/g, ""));
    });
  }

  getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }
}
