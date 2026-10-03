// Port of keiyoushi/extensions-source src/en/hentara/Hentara.kt (+ Dto.kt)
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
  isBlank,
  parseAs,
  substringAfter,
  substringAfterLast,
  tryParseInstant,
  type ClientBuilder,
} from "../../../sdk/index.ts";

// ---- Dto.kt
interface HentaraIndexDto {
  comics?: HentaraComicDto[];
}
interface HentaraGenreDto {
  name: string;
}
interface HentaraComicDto {
  title: string;
  slug: string;
  thumbnail_url?: string | null;
  view_count?: number;
  latest_episode_date?: string | null;
  genres?: HentaraGenreDto[];
}
interface HentaraMangaDto {
  comic: HentaraComicFullDto;
  episodes?: HentaraEpisodeShortDto[];
}
interface HentaraComicFullDto {
  title: string;
  slug: string;
  description?: string | null;
  thumbnail_url?: string | null;
  genres?: HentaraGenreDto[];
}
interface HentaraEpisodeShortDto {
  episode_number: number;
  title?: string | null;
  created_at?: string | null;
}
interface HentaraEpisodeDto {
  pages?: HentaraPageDto[];
}
interface HentaraPageDto {
  page_number: number;
  image_url: string;
}

function comicToSManga(c: HentaraComicDto | HentaraComicFullDto): SManga {
  const manga = SManga.create();
  manga.url = `/manhwa/${c.slug}`;
  manga.title = c.title;
  manga.thumbnail_url = c.thumbnail_url ?? undefined;
  if ("description" in c) manga.description = c.description ?? undefined;
  manga.genre = (c.genres ?? []).map((it) => it.name).join(", ");
  return manga;
}

function chapterName(ep: HentaraEpisodeShortDto): string {
  let s = `Chapter ${ep.episode_number}`;
  if (!isBlank(ep.title)) s += ` - ${ep.title}`;
  return s;
}

const GENRES = ["Any", "Action", "BL", "Cheating", "Detective", "Drama", "Harem", "In-Law", "MILF", "Married", "Office", "Romance", "Spin-Off", "Thriller", "University", "College", "Nerd"];

class GenreFilter extends Filter.Select<string> {
  constructor() {
    super("Genre", GENRES);
  }
}
class SortFilter extends Filter.Select<string> {
  constructor() {
    super("Sort", ["Latest", "Popular", "Alphabetical"]);
  }
}

const Api = {
  BASE: "https://hentara.com/r2-data",
  index: () => `${Api.BASE}/index.json`,
  comic: (slug: string) => `${Api.BASE}/comics/${slug}.json`,
  episode: (slug: string, ep: number) => `${Api.BASE}/episodes/${slug}/${ep}.json`,
};

export default class Hentara extends KeiSource {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2);
  }

  // ============================== Popular ==============================
  async getPopularManga(_page: number): Promise<MangasPage> {
    return this.searchIndex("", 1, 0);
  }

  // ============================== Latest ===============================
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    return this.searchIndex("", 0, 0);
  }

  // ============================== Search ===============================
  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const sortIdx = firstInstanceOrNull(filters, SortFilter)?.state ?? 0;
    const genreIdx = firstInstanceOrNull(filters, GenreFilter)?.state ?? 0;
    return this.searchIndex(query, sortIdx, genreIdx);
  }

  private async searchIndex(query: string, sortIdx: number, genreIdx: number): Promise<MangasPage> {
    const data = parseAs<HentaraIndexDto>((await this.client.get(Api.index())).text());
    const genre = GENRES[genreIdx] ?? "Any";

    let filtered = (data.comics ?? []).filter(
      (comic) =>
        (isBlank(query) || comic.title.toLowerCase().includes(query.toLowerCase())) &&
        (genre === "Any" || (comic.genres ?? []).some((it) => it.name.toLowerCase() === genre.toLowerCase())),
    );
    // Array.prototype.sort is stable, like Kotlin's sortedBy
    if (sortIdx === 0) filtered = filtered.sort((a, b) => tryParseInstant(b.latest_episode_date) - tryParseInstant(a.latest_episode_date));
    else if (sortIdx === 1) filtered = filtered.sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0));
    else if (sortIdx === 2) filtered = filtered.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

    return new MangasPage(filtered.map(comicToSManga), false);
  }

  // ============================== Details ==============================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = substringAfterLast(manga.url, "/");
    const data = parseAs<HentaraMangaDto>((await this.client.get(Api.comic(slug))).text());
    const comicSlug = data.comic.slug;

    const chapterList = (data.episodes ?? [])
      .map((ep) => {
        const chapter = SChapter.create();
        chapter.url = `/manhwa/${comicSlug}/chapter-${ep.episode_number}`;
        chapter.name = chapterName(ep);
        chapter.chapter_number = ep.episode_number;
        chapter.date_upload = tryParseInstant(ep.created_at);
        return chapter;
      })
      .sort((a, b) => b.chapter_number - a.chapter_number);

    return new SMangaUpdate(comicToSManga(data.comic), chapterList);
  }

  // =============================== Pages ===============================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const pathSegments = chapter.url.replace(/^\/+|\/+$/g, "").split("/");
    if (pathSegments.length < 3) throw new Error(`Malformed chapter URL: ${chapter.url}`);
    const slug = pathSegments[1];
    const epStr = substringAfter(pathSegments[2], "chapter-");
    const ep = /^[+-]?\d+$/.test(epStr) ? Number.parseInt(epStr, 10) : null;
    if (ep === null) throw new Error(`Malformed chapter URL: ${chapter.url}`);

    const data = parseAs<HentaraEpisodeDto>((await this.client.get(Api.episode(slug, ep))).text());
    return (data.pages ?? []).map((it) => new Page(it.page_number - 1, "", it.image_url));
  }

  // ============================== Filters ==============================
  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new GenreFilter());
  }
}
