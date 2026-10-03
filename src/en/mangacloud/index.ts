// Port of keiyoushi/extensions-source src/en/mangacloud/MangaCloud.kt
// (with Dto.kt and PayloadDto.kt; the Turnstile handshake upstream solves in a WebView is not ported: it throws)
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
  ZoneOffset,
  firstInstanceOrNull,
  parseAs,
  substringBefore,
  type ClientBuilder,
} from "../../../sdk/index.ts";
import { SortFilter, StatusFilter, TriStateGroupFilter, TypeFilter } from "./filters.ts";

const DOMAIN = "mangacloud.org";
const API_URL = `https://api.${DOMAIN}`;
const CDN_URL = `https://pika.${DOMAIN}`;

// --- Dto.kt
interface Data<T> {
  data: T;
}
interface DataList<T> {
  list: T[];
}
interface Image {
  id: string;
  f: string; // format
}
interface BrowseManga {
  id: string;
  title: string;
  cover: Image;
}
interface Tag {
  id: string;
  name: string;
  type: string;
}
interface Links {
  al?: number | null;
  mal?: number | null;
  md?: string | null;
  mu?: string | null;
}
interface ChapterDto {
  id: string;
  number: number;
  name?: string | null;
  created_date: string;
}
interface MangaDto {
  id: string;
  title: string;
  alt_titles?: string | null;
  nat_titles?: string | null;
  description?: string | null;
  status: string;
  start_year?: number | null;
  end_year?: number | null;
  type?: string | null;
  authors?: string | null;
  artists?: string | null;
  official_raw?: string | null;
  official_english?: string | null;
  links: Links;
  tags: Tag[];
  chapters: ChapterDto[];
  cover: Image;
}
interface ChapterUrl {
  comicId: string;
  chapterId: string;
}
interface ChapterContent {
  id: string;
  comic_id: string;
  images: Image[];
}

const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.ENGLISH);

function browseToSManga(m: BrowseManga): SManga {
  const manga = SManga.create();
  manga.url = m.id;
  manga.title = m.title;
  manga.thumbnail_url = `${CDN_URL}/${m.id}/${m.cover.id}.${m.cover.f}`;
  return manga;
}

function mangaToSManga(m: MangaDto): SManga {
  // Injekt.get<Application>().packageName: the reader is neither Mihon, SY nor Komikku, so no grouped tags/markdown links
  const groupTags = false;
  const markdownDescription = false;
  const split = (s: string | null | undefined, sep: string) => s?.split(sep).map((it) => it.trim());

  const manga = SManga.create();
  manga.url = m.id;
  manga.title = m.title;
  manga.artist = split(m.artists, "•")?.join(", ");
  manga.author = split(m.authors, "•")?.join(", ");

  let description = "";
  if (m.description != null) description += `${m.description.trim()}\n\n`;
  if (m.start_year != null) {
    description += `Year: ${m.start_year}`;
    if (m.end_year != null) description += ` - ${m.end_year}`;
    description += "\n\n";
  }
  const alt = [...(split(m.alt_titles, "•") ?? []), ...(split(m.nat_titles, "、") ?? [])];
  if (alt.length) {
    description += "Alternative Name(s):\n";
    for (const name of alt) description += `- ${name}\n`;
    description += "\n";
  }
  if (markdownDescription) {
    const links: [string, string][] = [];
    if (m.official_raw != null) links.push(["Official Raw", m.official_raw]);
    if (m.official_english != null) links.push(["Official English", m.official_english]);
    if (m.links.al != null) links.push(["Anilist", `https://anilist.co/manga/${m.links.al}`]);
    if (m.links.mal != null) links.push(["MyAnimeList", `https://myanimelist.net/manga/${m.links.mal}`]);
    if (m.links.mu != null) links.push(["MangaUpdates", `https://www.mangaupdates.com/series/${m.links.mu}`]);
    if (m.links.md != null) links.push(["MangaDex", `https://mangadex.org/title/${m.links.md}`]);
    if (links.length) {
      description += "Links:\n";
      for (const [name, link] of links) description += `- [${name}](${link})\n`;
    }
  }
  manga.description = description.trim();

  const genre: string[] = [];
  if (m.type != null) genre.push(groupTags ? `Type:${m.type}` : m.type);
  // sortedBy is stable, as Array.prototype.sort
  [...m.tags]
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
    .forEach((tag) => genre.push(groupTags ? `${tag.type.charAt(0).toUpperCase() + tag.type.slice(1)}:${tag.name}` : tag.name));
  manga.genre = genre.join(", ");

  switch (m.status) {
    case "Ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "Completed":
      manga.status = SManga.COMPLETED;
      break;
    case "Cancelled":
      manga.status = SManga.CANCELLED;
      break;
    case "Hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  manga.thumbnail_url = `${CDN_URL}/${m.id}/${m.cover.id}.${m.cover.f}`;
  manga.initialized = true;
  return manga;
}

/** Kotlin's Float.toString() for the values chapter numbers take: whole numbers keep ".0". */
const floatToString = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

export default class MangaCloud extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    // every api call returns 409 until a Turnstile token is posted to /auth/handshake, which the site does on load;
    // upstream runs the site in a WebView for that (handshakeInterceptor), which cannot be done here
    return builder
      .addChainInterceptor(async (chain) => {
        const request = chain.request();
        const response = await chain.proceed(request);
        if (response.code !== 409 || new URL(request.url).hostname !== new URL(API_URL).hostname) return response;
        throw new Error("Open in WebView to complete the site handshake (Turnstile)");
      })
      .rateLimit(1);
  }

  private jsonHeaders(): Headers {
    const h = this.headers;
    h.set("Content-Type", "application/json");
    return h;
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    if (page > 3) return this.getSearchMangaList(page - 3, "", FilterList());

    const time = page === 1 ? "today" : page === 2 ? "week" : "month";

    const data = (await this.client.get(`${API_URL}/comic-popular-view/${time}`)).parseAs<Data<DataList<BrowseManga>>>();
    return new MangasPage(data.data.list.map(browseToSManga), true);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const payload = JSON.stringify({ page });

    const data = (await this.client.post(`${API_URL}/comic-updates`, this.jsonHeaders(), payload)).parseAs<Data<DataList<BrowseManga>>>();

    const mangas = data.data.list.map(browseToSManga);
    return new MangasPage(mangas, data.data.list.length === 60);
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${API_URL}/tag/list`)).parseAs<Data<Tag[]>>().data;
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new TypeFilter(), new StatusFilter(), new SortFilter()];

    const tags = data as Tag[] | null;
    if (tags != null) {
      const group = (name: string, type: string) =>
        new TriStateGroupFilter(
          name,
          tags.filter((it) => it.type === type).map((it) => [it.name, it.id] as [string, string]),
        );
      filters.push(group("Genre", "genre"), group("Theme", "theme"), group("Format", "format"));
    }
    return FilterList(...filters);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.trim() !== "" && query.length < 3) throw new Error("Search query must be more than 3 characters!");

    const groups = filters.filter((it): it is TriStateGroupFilter => it instanceof TriStateGroupFilter);
    const includes = groups.flatMap((it) => it.included);
    const excludes = groups.flatMap((it) => it.excluded);
    // explicitNulls = false, encodeDefaults = false: null and empty-list fields are not sent
    const payload = JSON.stringify({
      title: query.trim() !== "" ? query : undefined,
      type: firstInstanceOrNull(filters, TypeFilter)?.selected ?? undefined,
      sort: firstInstanceOrNull(filters, SortFilter)?.selected ?? undefined,
      status: firstInstanceOrNull(filters, StatusFilter)?.selected ?? undefined,
      includes: includes.length ? includes : undefined,
      excludes: excludes.length ? excludes : undefined,
      page,
    });

    const data = (await this.client.post(`${API_URL}/comic/library`, this.jsonHeaders(), payload)).parseAs<Data<BrowseManga[]>>();

    const mangas = data.data.map(browseToSManga);
    return new MangasPage(mangas, data.data.length === 10);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const path = url.pathname.slice(1).split("/");

    if (url.hostname !== DOMAIN || path[0] !== "comic" || path.length <= 1) return null;

    return mangaToSManga((await this.client.get(`${API_URL}/comic/${path[1]}`)).parseAs<Data<MangaDto>>().data);
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/comic/${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const data = (await this.client.get(`${API_URL}/comic/${manga.url}`)).parseAs<Data<MangaDto>>().data;

    const updatedChapters = data.chapters.map((chapter) => {
      const c = SChapter.create();
      c.url = JSON.stringify({ comicId: data.id, chapterId: chapter.id } satisfies ChapterUrl);
      let name = `Chapter ${substringBefore(floatToString(chapter.number), ".0")}`;
      if (chapter.name != null) name += ` - ${chapter.name}`;
      c.name = name;
      c.chapter_number = chapter.number;
      c.date_upload = dateFormat.tryParseDateTime(chapter.created_date.slice(0, 19), ZoneOffset.UTC);
      return c;
    });

    return new SMangaUpdate(mangaToSManga(data), updatedChapters);
  }

  override getChapterUrl(chapter: SChapter): string {
    const chapterUrl = parseAs<ChapterUrl>(chapter.url);
    return `${this.baseUrl}/comic/${chapterUrl.comicId}/chapter/${chapterUrl.chapterId}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterId = parseAs<ChapterUrl>(chapter.url).chapterId;

    const data = (await this.client.get(`${API_URL}/chapters/${chapterId}`)).parseAs<Data<ChapterContent>>().data;

    return data.images.map((img, idx) => new Page(idx, "", `${CDN_URL}/${data.comic_id}/${data.id}/${img.id}.${img.f}`));
  }
}
