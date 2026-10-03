// Port of keiyoushi/extensions-source src/all/taddyink/TaddyInk.kt (+ TaddyUtils.kt)
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  substringAfterLast,
  toHttpUrl,
  tryParseInstant,
  type ClientBuilder,
  type FilterList as FilterListType,
  type PreferenceScreen,
} from "../../../sdk/index.ts";

// --- TaddyUtils.kt
interface ComicResults {
  comicseries?: Comic[];
}
interface Comic {
  name?: string;
  url: string;
  description?: string | null;
  genres?: string[] | null;
  creators?: Creator[] | null;
  coverImage?: CoverImage | null;
  issues?: Chapter[] | null;
}
interface CoverImage {
  base_url?: string | null;
  cover_sm?: string | null;
}
interface Creator {
  name?: string | null;
}
interface Chapter {
  identifier: string;
  name: string;
  datePublished: string;
  stories?: Story[] | null;
}
interface Story {
  storyImage?: StoryImage | null;
}
interface StoryImage {
  base_url?: string | null;
  story?: string | null;
}

const genrePairs: [string, string][] = [
  ["", ""],
  ["Action", "COMICSERIES_ACTION"],
  ["Comedy", "COMICSERIES_COMEDY"],
  ["Drama", "COMICSERIES_DRAMA"],
  ["Educational", "COMICSERIES_EDUCATIONAL"],
  ["Fantasy", "COMICSERIES_FANTASY"],
  ["Historical", "COMICSERIES_HISTORICAL"],
  ["Horror", "COMICSERIES_HORROR"],
  ["Inspirational", "COMICSERIES_INSPIRATIONAL"],
  ["Mystery", "COMICSERIES_MYSTERY"],
  ["Romance", "COMICSERIES_ROMANCE"],
  ["Sci-Fi", "COMICSERIES_SCI_FI"],
  ["Slice Of Life", "COMICSERIES_SLICE_OF_LIFE"],
  ["Superhero", "COMICSERIES_SUPERHERO"],
  ["Supernatural", "COMICSERIES_SUPERNATURAL"],
  ["Wholesome", "COMICSERIES_WHOLESOME"],
  ["BL (Boy Love)", "COMICSERIES_BL"],
  ["GL (Girl Love)", "COMICSERIES_GL"],
  ["LGBTQ+", "COMICSERIES_LGBTQ"],
  ["Thriller", "COMICSERIES_THRILLER"],
  ["Zombies", "COMICSERIES_ZOMBIES"],
  ["Post Apocalyptic", "COMICSERIES_POST_APOCALYPTIC"],
  ["School", "COMICSERIES_SCHOOL"],
  ["Sports", "COMICSERIES_SPORTS"],
  ["Animals", "COMICSERIES_ANIMALS"],
  ["Gaming", "COMICSERIES_GAMING"],
];
const genreMap = new Map(genrePairs.map(([name, id]) => [id, name]));

function getManga(comicObj: Comic): SManga {
  const genres = (comicObj.genres ?? [])
    .map((it) => genreMap.get(it))
    .filter((it): it is string => it !== undefined)
    .join(", ");

  const creators = comicObj.creators?.map((it) => it.name).filter((it): it is string => it != null).join(", ");

  const thumbnailBaseUrl = comicObj.coverImage?.base_url ?? "";
  const thumbnail = comicObj.coverImage?.cover_sm ?? "";
  const thumbnailUrl = thumbnailBaseUrl && thumbnail ? `${thumbnailBaseUrl}${thumbnail}` : "";

  const manga = SManga.create();
  manga.url = comicObj.url;
  manga.title = comicObj.name ?? "Unknown";
  if (creators && creators.trim()) manga.author = creators;
  manga.description = comicObj.description ?? undefined;
  manga.thumbnail_url = thumbnailUrl;
  manga.status = SManga.ONGOING;
  manga.genre = genres;
  return manga;
}

// --- TaddyInk.kt
const TITLE_PREF_KEY = "display_full_title";
const TITLE_PREF = "Display manga title as";
const POPULAR_MANGA_LIMIT = 25;
const SEARCH_MANGA_LIMIT = 25;

class AdvSearchEntryFilter extends Filter.Text {}
class CreatorFilter extends AdvSearchEntryFilter {
  constructor() {
    super("Creator");
  }
}
class TagFilter extends AdvSearchEntryFilter {
  constructor() {
    super("Tags");
  }
}
class UriPartFilter extends Filter.Select<string> {
  constructor(displayName: string, readonly vals: [string, string][]) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}
class GenreFilter extends UriPartFilter {
  constructor() {
    super("Filter By Genre", genrePairs);
  }
}

export default class TaddyInk extends KeiSource {
  private readonly taddyLang = "";

  override get supportsLatest() {
    return false;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(4);
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat();
    p.key = TITLE_PREF_KEY;
    p.title = TITLE_PREF;
    // summaryOn = "Full Title", summaryOff = "Short Title": the reader shows one static summary
    p.summary = "Full Title / Short Title";
    p.setDefaultValue(true);
    screen.addPreference(p);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/feeds/directory/list`)!
      .newBuilder()
      .addQueryParameter("lang", this.taddyLang)
      .addQueryParameter("taddyType", "comicseries")
      .addQueryParameter("ua", "tc")
      .addQueryParameter("page", String(page))
      .addQueryParameter("limit", String(POPULAR_MANGA_LIMIT))
      .build();

    return this.parseManga((await this.client.get(url.toString())).parseAs<ComicResults>());
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    // pathSegments[1] is the slug used to identify the comic
    if (url.pathname.split("/").filter((s, i) => i > 0)[1] === undefined) return null;

    const comic = (await this.client.get(url)).parseAs<Comic>();
    const manga = getManga(comic);
    manga.url = url.toString();
    return manga;
  }

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const genreFilter = firstInstanceOrNull(filters, GenreFilter);
    const creatorFilter = firstInstanceOrNull(filters, CreatorFilter);
    const tagFilter = firstInstanceOrNull(filters, TagFilter);

    const url = toHttpUrl(`${this.baseUrl}/feeds/directory/search`)!
      .newBuilder()
      .addQueryParameter("q", query)
      .addQueryParameter("lang", this.taddyLang)
      .addQueryParameter("taddyType", "comicseries")
      .addQueryParameter("ua", "tc")
      .addQueryParameter("page", String(page))
      .addQueryParameter("limit", String(SEARCH_MANGA_LIMIT));

    if (genreFilter != null && genreFilter.state !== 0) url.addQueryParameter("genre", genreFilter.toUriPart());
    if (creatorFilter != null && creatorFilter.state.trim()) url.addQueryParameter("creator", creatorFilter.state);
    if (tagFilter != null && tagFilter.state.trim()) url.addQueryParameter("tags", tagFilter.state);

    return this.parseManga((await this.client.get(url.build().toString())).parseAs<ComicResults>());
  }

  private parseManga(comicSeries: ComicResults): MangasPage {
    const list = comicSeries.comicseries ?? [];
    const mangas = list.map((it) => getManga(it));
    const hasNextPage = list.length === POPULAR_MANGA_LIMIT;
    return new MangasPage(mangas, hasNextPage);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const comic = (await this.client.get(manga.url)).parseAs<Comic>();
    const sssUrl = comic.url;
    const issues = comic.issues ?? [];

    const chapterList = issues.map((chapter, i) => {
      const c = SChapter.create();
      c.url = `${sssUrl}#${chapter.identifier}`;
      c.name = chapter.name;
      c.date_upload = tryParseInstant(chapter.datePublished);
      c.chapter_number = issues.length - i;
      return c;
    });

    return new SMangaUpdate(getManga(comic), chapterList.reverse());
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const issueUuid = substringAfterLast(chapter.url, "#");
    const comic = (await this.client.get(chapter.url)).parseAs<Comic>();

    const issue = (comic.issues ?? []).find((it) => it.identifier === issueUuid);

    return (issue?.stories ?? []).map((storyObj, index) => new Page(index, "", `${storyObj.storyImage?.base_url}${storyObj.storyImage?.story}`));
  }

  override getFilterList(_data: unknown = null): FilterListType {
    return FilterList(new GenreFilter(), new Filter.Separator(), new Filter.Header("Filter by the creator or tags:"), new CreatorFilter(), new TagFilter());
  }
}
