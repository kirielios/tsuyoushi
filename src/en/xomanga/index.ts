// Port of keiyoushi/extensions-source src/en/xomanga/XoManga.kt (+ Dto.kt)
import {
  DateTimeFormatter,
  FilterList,
  HttpUrl,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
} from "../../../sdk/index.ts";

// ---- Dto.kt
interface Manga {
  title: string;
  image: string | null;
  link: string;
}
interface IndexResponse {
  latest: Manga[];
}
interface Chapters {
  chapter: number;
  link: string;
  date: string;
}
interface DetailsResponse {
  title: string;
  description: string | null;
  cover: string | null;
  tags: string[] | null;
  status: string | null;
  chapters_list: Chapters[];
}
interface ImageResponse {
  images: string[];
}

function mangaToSManga(m: Manga, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.url = String(HttpUrl.parse(baseUrl + m.link).queryParameter("id")); // Kotlin's null.toString()
  manga.title = m.title;
  manga.thumbnail_url = m.image ?? undefined;
  return manga;
}
const matchesQuery = (m: Manga, query: string) => query.length === 0 || m.title.toLowerCase().includes(query);
const isExclusive = (m: Manga, exclusiveTitles: Set<string>) => {
  const normalised = m.title.toLowerCase().trim().replace(/\s+/g, " ");
  return [...exclusiveTitles].some((it) => normalised.includes(it));
};

function detailsToSManga(d: DetailsResponse): SManga {
  const manga = SManga.create();
  manga.title = d.title;
  manga.description = d.description ?? undefined;
  manga.genre = d.tags?.join(", ");
  manga.status = { ongoing: SManga.ONGOING, completed: SManga.COMPLETED, hiatus: SManga.ON_HIATUS, cancelled: SManga.CANCELLED }[d.status ?? ""] ?? SManga.UNKNOWN;
  manga.thumbnail_url = d.cover ?? undefined;
  return manga;
}

const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT);
function chapterToSChapter(c: Chapters, baseUrl: string): SChapter {
  const chapter = SChapter.create();
  const urlLink = HttpUrl.parse(baseUrl + c.link);
  const slug = urlLink.queryParameter("id");
  const chapterNum = urlLink.queryParameter("ch");
  const chapterStr = c.chapter % 1 === 0 ? String(Math.trunc(c.chapter)) : String(c.chapter);
  chapter.url = `${slug}#${chapterNum}`;
  chapter.name = `Chapter ${chapterStr}`;
  chapter.date_upload = dateFormat.tryParseDate(c.date);
  chapter.chapter_number = c.chapter;
  return chapter;
}

const EXCLUSIVE_REGEX = /myExclusiveWorksTitles\s*=\s*\[([^\]]+)\]/s;
const QUOTED_REGEX = /["']([^"'\n]+)["']/g;

export default class XoManga extends KeiSource {
  // ============================== Popular ===============================
  async getPopularManga(_page: number): Promise<MangasPage> {
    const body = (await this.client.get(`${this.baseUrl}/our-works`)).text();
    const block = EXCLUSIVE_REGEX.exec(body)?.[1];
    if (block === undefined) return new MangasPage([], false);
    const exclusiveTitles = new Set([...block.matchAll(QUOTED_REGEX)].map((m) => m[1].toLowerCase().trim().replace(/\s+/g, " ")));
    const index = (await this.client.get(`${this.baseUrl}/index.json`)).parseAs<IndexResponse>();
    const mangas = index.latest.filter((it) => isExclusive(it, exclusiveTitles)).map((it) => mangaToSManga(it, this.baseUrl));
    return new MangasPage(mangas, false);
  }

  // =============================== Latest ===============================
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const result = (await this.client.get(`${this.baseUrl}/index.json`)).parseAs<IndexResponse>();
    return new MangasPage(
      result.latest.map((it) => mangaToSManga(it, this.baseUrl)),
      false,
    );
  }

  // =============================== Search ===============================
  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const result = (await this.client.get(`${this.baseUrl}/index.json`)).parseAs<IndexResponse>();
    const mangas = result.latest.filter((it) => matchesQuery(it, query)).map((it) => mangaToSManga(it, this.baseUrl));
    return new MangasPage(mangas, false);
  }

  protected override async getMangaByUrl(u: URL): Promise<SManga | null> {
    const id = HttpUrl.parse(u.toString()).queryParameter("id");
    if (id == null) return null;
    const manga = SManga.create();
    manga.url = id;

    const updated = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    updated.initialized = true;
    updated.url = id;
    return updated;
  }

  // =========================== Manga Updates ============================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = (await this.client.get(`${this.baseUrl}/manga/${manga.url}/details.json`)).parseAs<DetailsResponse>();
    return new SMangaUpdate(
      detailsToSManga(details),
      details.chapters_list.map((it) => chapterToSChapter(it, this.baseUrl)),
    );
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/details.html?id=${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const url = HttpUrl.parse(`${this.baseUrl}/${chapter.url}`);
    const slug = url.pathSegments[0];
    const chapterNum = url.fragment;
    return HttpUrl.parse(`${this.baseUrl}/reader.html`).newBuilder().addQueryParameter("id", slug).addQueryParameter("ch", chapterNum).build().toString();
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = HttpUrl.parse(`${this.baseUrl}/${chapter.url}`);
    const slug = url.pathSegments[0];
    const chapterNum = url.fragment;
    const images = (await this.client.get(`${this.baseUrl}/manga/${slug}/chapters/${chapterNum}.json`)).parseAs<ImageResponse>().images;
    return images.map((url, i) => new Page(i, "", url));
  }
}
