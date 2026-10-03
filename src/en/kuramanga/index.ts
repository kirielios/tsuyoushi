// Port of keiyoushi/extensions-source src/en/kuramanga/KuraManga.kt (+ Filters.kt, Dto.kt)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  distinctBy,
  substringAfter,
  toHttpUrl,
  type Document,
  type FilterList as FilterListType,
} from "../../../sdk/index.ts";

// --- Filters.kt
abstract class SelectFilter extends Filter.Select<string> {
  constructor(name: string, readonly vals: string[]) {
    super(name, vals);
  }
}
class StatusFilter extends SelectFilter {}
class Genre extends Filter.CheckBox {}
class GenreFilter extends Filter.Group<Genre> {}
class AdultFilter extends Filter.CheckBox {
  constructor(name: string) {
    super(name, true);
  }
}

const statusList = ["All", "Ongoing", "Completed", "Hiatus", "On Hold", "Canceled"];

const genreNames = [
  "+100 Chapter", "Ability", "Academy", "Acting", "Action", "Adaptation", "Adult", "Adventure", "Ai", "Aliens",
      "Animals", "Anthology", "Apocalypse", "Award Winning", "Battleofintellect", "BDSM", "BL", "Borderline H",
      "Boys Love", "Bullying", "Campus", "Cheating/infidelity", "Cohabitation", "College", "College life", "Comedy",
      "Comic", "Cooking", "Crazy MC", "Crime", "Crossdressing", "Cultivation", "Curse", "Dark Fantasy", "Darkfantasy",
      "Delinquents", "Demon", "Demons", "Difference in Status", "Doujinshi", "Drama", "Dungeons", "Ecchi", "Elementals",
      "Elf", "Explicit Sex", "Family", "Fantasia", "Fantasy", "Fight", "Folklore", "Friday Webtoons", "Full Color",
      "Game", "Gamelit", "Gang", "Gender Bender", "Genderswap", "Genius", "Genius MC", "Ghosts", "Girls Love", "GL",
      "Gore", "Growth", "Guideverse", "Hardcore", "Harem", "Hentai", "Hidden", "Historical", "Horror", "Humiliation",
      "Hunter", "Hunters", "Hypnosis", "Idols", "Illusion", "Incest", "Isekai", "Josei", "Legendary", "Live",
      "Long Strip", "Love Triangle", "Mafia", "Magic", "Magical", "Manhua", "Manhwa", "Married Woman", "Martial Arts",
      "Mature", "Mecha", "Medical", "Milf", "Military", "Modernfantasy", "Money", "Monster Girls", "Monsters", "Mother",
      "Mother and Daughter", "Murim", "Music", "Mystery", "Myth", "Necromancer", "Netori", "Nonhumanbeings",
      "Novel Adaptation", "Ntl", "NTR", "Office", "Office Workers", "Omegaverse", "One shot", "Original Novel",
      "Overpowered", "Overpoweredmc", "Philosophical", "Politics", "Post-Apocalyptic", "Psychological", "Raw", "Reborn",
      "Regression", "Reincarnation", "Returner", "Revenge", "Reverse Harem", "Robots", "Romance", "Royal family",
      "School", "School Life", "Schoollife", "Sci-Fi", "Seinen", "Serial", "Short Story", "Shoujo", "Shounen",
      "Shounen Ai", "Showbiz", "Sisters", "Slice of Life", "Sm", "Smut", "Sport", "Sports", "Stepmother", "Superhero",
      "Supernatural", "Superpower", "Survival", "Swapping", "Swordsman", "System", "Teacher", "Threesome", "Thriller",
      "Time Travel", "Tower", "Traditional Games", "Tragedy", "Training", "Transmigration", "Uncensored", "Urban",
      "Vampires", "Video Games", "Villain", "Villainess", "Violence", "Virtual Reality", "Visualshock", "Web Comic",
      "Webtoon", "Webtoons", "Wholesome", "Workplace", "Wuxia", "Xuanhuan", "Yaoi", "Yuri", "Zombies",
];

// --- Dto.kt
interface SearchResponse {
  data?: MangaDto[];
  total?: number;
}
interface MangaDto {
  title: string;
  thumb?: string | null;
  cover_image_url?: string | null;
  normalized_title: string;
}
function mangaDtoToSManga(dto: MangaDto): SManga {
  const manga = SManga.create();
  manga.title = dto.title;
  manga.url = `/${dto.normalized_title}`;
  manga.thumbnail_url = dto.thumb ?? dto.cover_image_url ?? undefined;
  return manga;
}

const PAGE_SIZE = 18;

const removePrefix = (s: string, p: string) => (s.startsWith(p) ? s.slice(p.length) : s);

// --- KuraManga.kt
export default class KuraManga extends KeiSource {
  // ============================== Popular ===============================
  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    const mangas: SManga[] = [];
    for (const element of document.select("section:has(h2:contains(Popular)) a.sp-card")) {
      const titleEl = element.selectFirst(".sp-cap h3");
      if (titleEl == null) continue;
      const manga = SManga.create();
      manga.title = titleEl.text();
      manga.url = "/" + removePrefix(element.attr("href"), "/");
      manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
      mangas.push(manga);
    }
    return new MangasPage(mangas, false);
  }

  // =============================== Latest ===============================
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const pageUrl = page > 1 ? `${this.baseUrl}/?page=${page}` : `${this.baseUrl}/`;
    const document = (await this.client.get(pageUrl)).asJsoup();
    const list: SManga[] = [];
    for (const element of document.select(".update-list .update-row")) {
      const link = element.selectFirst("a.update-series-link");
      if (link == null) continue;
      const manga = SManga.create();
      manga.title = link.text();
      manga.url = "/" + removePrefix(link.attr("href"), "/");
      manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
      list.push(manga);
    }
    const mangas = distinctBy(list, (it) => it.url);

    const hasNextPage = document.selectFirst("a[data-lu-next]:not(.is-disabled)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // =============================== Search ===============================
  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const b = toHttpUrl(`${this.baseUrl}/search`)!.newBuilder();
    b.addQueryParameter("ajax", "1");
    b.addQueryParameter("page", String(page));
    if (query.trim()) b.addQueryParameter("name", query);

    for (const filter of filters) {
      if (filter instanceof GenreFilter) {
        const genres = filter.state.filter((it) => it.state).map((it) => it.name);
        if (genres.length > 0) b.addQueryParameter("genre", genres.join(","));
      } else if (filter instanceof StatusFilter) {
        if (filter.state !== 0) b.addQueryParameter("status", filter.vals[filter.state].replaceAll(" ", "_").toLowerCase());
      } else if (filter instanceof AdultFilter) {
        if (!filter.state) b.addQueryParameter("adult", "0");
      }
    }
    const url = b.build();

    const searchHeaders = new Headers(this.headers);
    searchHeaders.append("X-Requested-With", "XMLHttpRequest");
    const response = (await this.client.get(url.toString(), searchHeaders)).parseAs<SearchResponse>();

    const data = response.data ?? [];
    const mangas = data.map((it) => mangaDtoToSManga(it));
    const total = response.total ?? 0;
    const hasNextPage = data.length === PAGE_SIZE && (total === 0 || page * PAGE_SIZE < total);
    return new MangasPage(mangas, hasNextPage);
  }

  // =========================== Manga Details ============================
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    try {
      if (url.host !== new URL(this.baseUrl).host) return null;
      const slug = url.pathname.split("/").find((it) => it.trim());
      if (slug == null) return null;
      if (["search", "assets", "api", "login", "register"].includes(slug)) return null;
      const document = (await this.client.get(`${this.baseUrl}/${slug}`)).asJsoup();
      const manga = this.mangaDetailsParse(document);
      manga.url = `/${slug}`;
      return manga;
    } catch {
      return null; // runCatching { ... }.getOrNull()
    }
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const details = this.mangaDetailsParse(document);
    details.url = manga.url;
    return new SMangaUpdate(details, this.chapterListParse(document));
  }

  private mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.title = document.selectFirst("h1.manga-title")!.text();
    manga.description = document.selectFirst(".summary-inner")?.text() ?? document.selectFirst(".mp-synopsis")?.text();
    const storyAndArt =
      document.selectFirst(".mp-cred:has(.mp-cred-k:contains(Story & Art)) .mp-cred-v")?.text() ??
      document.selectFirst(".mp-cred:has(.mp-cred-k:contains(Author & Artist)) .mp-cred-v")?.text();
    manga.author =
      document.selectFirst(".mp-cred:has(.mp-cred-k:contains(Author)) .mp-cred-v")?.text() ??
      document.selectFirst(".mp-cred:has(.mp-cred-k:contains(Story)) .mp-cred-v")?.text() ??
      storyAndArt ??
      optTrim(document.selectFirst(".meta-grid div:contains(Author:)")?.text(), "Author:");
    manga.artist =
      document.selectFirst(".mp-cred:has(.mp-cred-k:contains(Artist)) .mp-cred-v")?.text() ??
      document.selectFirst(".mp-cred:has(.mp-cred-k:contains(Art)) .mp-cred-v")?.text() ??
      storyAndArt ??
      optTrim(document.selectFirst(".meta-grid div:contains(Artist:)")?.text(), "Artist:");
    manga.genre = document.select(".genre-list a.genre-chip").map((it) => it.text()).join(", ");
    const statusText = document.selectFirst(".mp-status")?.text() ?? (() => {
      const t = document.selectFirst(".meta-grid div:contains(Status:)")?.text();
      return t == null ? undefined : substringAfter(t, "Status:");
    })();
    manga.status = this.parseStatus(statusText?.trim().toLowerCase());
    manga.thumbnail_url = document.selectFirst("meta[property='og:image']")?.attr("content");
    manga.initialized = true;
    return manga;
  }

  private parseStatus(s: string | undefined): number {
    switch (s) {
      case "ongoing":
      case "upcoming":
        return SManga.ONGOING;
      case "completed":
        return SManga.COMPLETED;
      case "on_hold":
      case "on hold":
      case "hiatus":
        return SManga.ON_HIATUS;
      case "canceled":
      case "cancelled":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  // ============================== Chapters ==============================
  private chapterListParse(document: Document): SChapter[] {
    const chapters: SChapter[] = [];
    for (const element of document.select(".chapter-list .chapter-item")) {
      const link = element.selectFirst("a");
      if (link == null) continue;
      const chapter = SChapter.create();
      chapter.name = link.text();
      chapter.url = "/" + removePrefix(link.attr("href"), "/");
      chapter.date_upload = this.dateFormat.tryParseDate(element.selectFirst("time")?.text());
      chapters.push(chapter);
    }
    return chapters;
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("#chapterImages img").map((img, index) => new Page(index, "", img.attr("abs:data-src") || img.attr("abs:src")));
  }

  // ============================== Filters ===============================
  override getFilterList(_data: unknown = null): FilterListType {
    return FilterList(new StatusFilter("Status", statusList), new AdultFilter("Include Adult Content"), new GenreFilter("Genres", genreNames.map((it) => new Genre(it))));
  }

  // ============================== Private ===============================
  private readonly dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.ENGLISH);
}

/** `text?.substringAfter(prefix)?.trim()` */
function optTrim(text: string | undefined, prefix: string): string | undefined {
  return text == null ? undefined : substringAfter(text, prefix).trim();
}
