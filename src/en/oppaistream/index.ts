// Port of keiyoushi/extensions-source src/en/oppaistream/OppaiStream.kt (+ Filters.kt)
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstanceOrNull,
  substringAfter,
  substringBeforeLast,
  toHttpUrl,
  urlWithoutDomain,
  type FilterList as FilterListType,
} from "../../../sdk/index.ts";

// --- Filters.kt
class SelectFilter extends Filter.Select<string> {
  constructor(displayName: string, private readonly vals: [string, string][], defaultValue: string | null = null) {
    super(displayName, vals.map((it) => it[0]), Math.max(0, vals.findIndex((it) => it[1] === defaultValue)));
  }
  selectedValue() {
    return this.vals[this.state][1];
  }
}

class OrderByFilter extends SelectFilter {
  constructor(defaultOrder: string | null = null) {
    super(
      "Sort By",
      [
        ["", ""],
        ["A-Z", "az"],
        ["Z-A", "za"],
        ["Recently Released", "recent"],
        ["Oldest Releases", "old"],
        ["Most Views", "views"],
        ["Highest Rated", "rating"],
        ["Recently Uploaded", "uploaded"],
      ],
      defaultOrder,
    );
  }
}

class Genre extends Filter.TriState {
  constructor(name: string, readonly value: string) {
    super(name);
  }
}

class GenreListFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genre", genres);
  }
}

const getGenreList = (): Genre[] =>
  ([
  ["Adventure", "adventure"],
  ["Beach", "beach"],
  ["Blackmail", "blackmail"],
  ["Cheating", "cheating"],
  ["Comedy", "comedy"],
  ["Cooking", "cooking"],
  ["Drama", "drama"],
  ["Fantasy", "fantasy"],
  ["Harem", "harem"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Incest", "incest"],
  ["Mind Break", "mindbreak"],
  ["Mind Control", "mindcontrol"],
  ["Monster", "monster"],
  ["Mystery", "mystery"],
  ["NTR", "ntr"],
  ["Psychological", "psychological"],
  ["Rape", "rape"],
  ["Reverse Rape", "reverserape"],
  ["Romance", "romance"],
  ["School Life", "schoollife"],
  ["Sci-fi", "sci-fi"],
  ["Secret Relationship", "secretrelationship"],
  ["Slice of Life", "sliceoflife"],
  ["Smut", "smut"],
  ["Sports", "sports"],
  ["Supernatural", "supernatural"],
  ["Tragedy", "tragedy"],
  ["Yaoi", "yaoi"],
  ["Yuri", "yuri"],
  ["Big Boobs", "bigboobs"],
  ["Black Hair", "blackhair"],
  ["Blonde Hair", "blondehair"],
  ["Blue Hair", "bluehair"],
  ["Brown Hair", "brownhair"],
  ["Cosplay", "cosplay"],
  ["Dark Skin", "darkskin"],
  ["Demon", "demon"],
  ["Dominant Girl", "dominantgirl"],
  ["Elf", "elf"],
  ["Futanari", "futanari"],
  ["Glasses", "glasses"],
  ["Green Hair", "greenhair"],
  ["Gyaru", "gyaru"],
  ["Inverted Nipples", "invertednipples"],
  ["Loli", "loli"],
  ["Maid", "maid"],
  ["Milf", "milf"],
  ["Nekomimi", "nekomimi"],
  ["Nurse", "nurse"],
  ["Pink Hair", "pinkhair"],
  ["Pregnant", "pregnant"],
  ["Purple Hair", "purplehair"],
  ["Red Hair", "redhair"],
  ["School Girl", "schoolgirl"],
  ["Short Hair", "shorthair"],
  ["Small Boobs", "smallboobs"],
  ["Succubus", "succubus"],
  ["Swimsuit", "swimsuit"],
  ["Teacher", "teacher"],
  ["Tsundere", "tsundere"],
  ["Vampire", "vampire"],
  ["Virgin", "virgin"],
  ["White Hair", "whitehair"],
  ["Old", "old"],
  ["Shota", "shota"],
  ["Trap", "trap"],
  ["Ugly Bastard", "uglybastard"]
  ] as [string, string][]).map(([name, value]) => new Genre(name, value));

const SEARCH_LIMIT = 36;

// --- OppaiStream.kt
export default class OppaiStream extends KeiSource {
  private readonly cdnUrl = "https://myspacecat.pictures";

  // popular
  async getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", FilterList(new OrderByFilter("views")));
  }

  // latest
  async getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", FilterList(new OrderByFilter("uploaded")));
  }

  // search
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const slug = url.searchParams.get("m");
    if (slug == null) return null;

    const manga = SManga.create();
    manga.url = `/manhwa?m=${slug}`;
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const b = toHttpUrl(`${this.baseUrl}/api-search.php`)!.newBuilder();
    b.addQueryParameter("text", query);
    const orderBy = firstInstanceOrNull(filters, OrderByFilter);
    if (orderBy != null) b.addQueryParameter("order", orderBy.selectedValue());
    const genres = firstInstanceOrNull(filters, GenreListFilter);
    if (genres != null) {
      b.addQueryParameter("genres", genres.state.filter((it) => it.isIncluded()).map((it) => it.value).join(","));
      b.addQueryParameter("blacklist", genres.state.filter((it) => it.isExcluded()).map((it) => it.value).join(","));
    }
    b.addQueryParameter("page", `${page}`);
    b.addQueryParameter("limit", `${SEARCH_LIMIT}`);
    const url = b.build();

    const document = (await this.client.get(url.toString())).asJsoup();
    const elements = document.select("div.in-grid > a");

    const mangas = elements.map((element) => {
      const manga = SManga.create();
      manga.thumbnail_url = element.select("img.read-cover").attr("src");
      manga.title = element.select("h3.man-title").text();
      const rawUrl = element.absUrl("href");
      // URLDecoder.decode(..., "UTF-8"): '+' is a space
      const u = rawUrl.includes("/fw?to=") ? decodeURIComponent(substringAfter(rawUrl, "/fw?to=").replaceAll("+", " ")) : rawUrl;
      manga.url = urlWithoutDomain(u);
      return manga;
    });

    return new MangasPage(mangas, elements.length >= SEARCH_LIMIT);
  }

  // manga details + chapter list
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const updatedManga = manga;
    updatedManga.thumbnail_url = document.select(".cover-img").attr("src");
    const info = document.select(".manhwa-info-in");
    const h1 = info.select("h1");
    updatedManga.title = substringBeforeLast(h1.text(), "By").trim();
    updatedManga.author = h1.select("a.red").text();
    updatedManga.artist = updatedManga.author;
    updatedManga.genre = info.select(".genres h5").map((it) => it.text()).join(", ");
    updatedManga.description = info.select(".description").text();

    const chapterList = document.select(".sort-chapters > a").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.attr("href"));
      chapter.name = element.select("div > h4").text();
      chapter.date_upload = this.parseRelativeDate(element.select("div > h6").text());
      return chapter;
    });

    return new SMangaUpdate(updatedManga, chapterList);
  }

  // page list
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterUrl = toHttpUrl(`${this.baseUrl}${chapter.url}`)!;
    const slug = chapterUrl.queryParameter("m");
    const chapNo = chapterUrl.queryParameter("c");

    return (await this.client.get(`${this.cdnUrl}/manhwa/im.php?f-m=${slug}&c=${chapNo}`))
      .asJsoup()
      .select("img")
      .map((img, index) => new Page(index, "", img.attr("src")));
  }

  // filters
  override getFilterList(_data: unknown = null): FilterListType {
    return FilterList(new OrderByFilter(), new GenreListFilter(getGenreList()));
  }

  // helpers
  private parseRelativeDate(text: string): number {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const first = text.split(" ")[0].trim();
    if (!/^[+-]?\d+$/.test(first)) return 0;
    const relativeDate = Number.parseInt(first, 10);

    if (text.includes("second")) now.setSeconds(now.getSeconds() - relativeDate);
    else if (text.includes("minute")) now.setMinutes(now.getMinutes() - relativeDate);
    else if (text.includes("hour")) now.setHours(now.getHours() - relativeDate);
    else if (text.includes("day")) now.setDate(now.getDate() - relativeDate);
    else if (text.includes("week")) now.setDate(now.getDate() - relativeDate * 7);
    else if (text.includes("month")) now.setMonth(now.getMonth() - relativeDate);
    else if (text.includes("year")) now.setFullYear(now.getFullYear() - relativeDate);
    else return 0;
    return now.getTime();
  }
}
