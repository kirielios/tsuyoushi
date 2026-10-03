// Port of keiyoushi/extensions-source src/en/leslievictims/LeslieAndVictims.kt (+ Dto.kt)
import {
  FilterList,
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  substringBefore,
} from "../../../sdk/index.ts";

// ---- Dto.kt
interface ChapterRoot {
  url: string;
  mode: string;
  data: unknown;
}
interface LibraryEntry {
  id: string;
  title: string;
  cover: string;
  chapters: string[];
  chapter_roots?: Record<string, ChapterRoot>;
}

/** HttpUrl.run { "$encodedPath?$encodedQuery" } */
const pathAndQuery = (url: HttpUrl) => `${url.encodedPath}?${url.encodedQuery}`;

function entryToSManga(e: LibraryEntry, baseUrl: string): SManga {
  const manga = SManga.create();
  manga.url = pathAndQuery(HttpUrl.parse(`${baseUrl}/`).newBuilder().addQueryParameter("series", e.id).build());
  manga.title = e.title;
  manga.thumbnail_url = `${baseUrl}/${e.cover}`;
  manga.initialized = true;
  return manga;
}

/** String.toFloatOrNull() */
const toFloatOrNull = (s: string): number | null => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?$/.test(s) ? Number.parseFloat(s) : null);

function getChapters(e: LibraryEntry, baseUrl: string): SChapter[] {
  return [...e.chapters].reverse().map((chId) => {
    const chapter = SChapter.create();
    chapter.url = pathAndQuery(HttpUrl.parse(`${baseUrl}/`).newBuilder().addQueryParameter("series", e.id).addQueryParameter("ch", chId).build());
    chapter.name = `Chapter ${chId}`;
    chapter.chapter_number = toFloatOrNull(substringBefore(chId, " ")) ?? -1;
    return chapter;
  });
}

const pad2 = (i: number) => String(i).padStart(2, "0");

export default class LeslieAndVictims extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  // ============================== Popular ===============================
  async getPopularManga(_page: number): Promise<MangasPage> {
    const mangas = (await this.fetchLibrary()).map((it) => entryToSManga(it, this.baseUrl));
    return new MangasPage(mangas, false);
  }

  // =============================== Latest ===============================
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // =============================== Search ===============================
  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const mangas = (await this.fetchLibrary()).filter((it) => it.title.toLowerCase().includes(query.toLowerCase())).map((it) => entryToSManga(it, this.baseUrl));
    return new MangasPage(mangas, false);
  }

  // ============================== Details ===============================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const seriesId = HttpUrl.parse(this.baseUrl + manga.url).queryParameter("series");
    if (seriesId == null) throw new Error("Invalid manga URL");
    const entry = await this.findEntry(seriesId);
    return new SMangaUpdate(entryToSManga(entry, this.baseUrl), getChapters(entry, this.baseUrl));
  }

  // =============================== Pages ================================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const url = HttpUrl.parse(this.baseUrl + chapter.url);
    const seriesId = url.queryParameter("series");
    if (seriesId == null) throw new Error("Missing series ID in chapter URL");
    const chId = url.queryParameter("ch");
    if (chId == null) throw new Error("Missing chapter ID in chapter URL");

    const chapterRoot = (await this.findEntry(seriesId)).chapter_roots?.[chId];

    if (chapterRoot) {
      const rootUrl = chapterRoot.url;
      switch (chapterRoot.mode) {
        case "list":
          return (chapterRoot.data as string[]).map((file, i) => new Page(i, "", `${rootUrl}/${file}`));
        case "count": {
          const count = chapterRoot.data as number;
          return Array.from({ length: Math.max(count, 0) }, (_, k) => new Page(k, "", `${rootUrl}/${pad2(k + 1)}.webp`));
        }
        default:
          return [];
      }
    }

    const baseImgUrl = HttpUrl.parse(this.baseUrl).newBuilder().addPathSegment("content").addPathSegment(seriesId).addPathSegment(chId).build();

    const pages: Page[] = [];
    let pageNum = 1;
    while (pageNum <= 150) {
      const imgUrl = baseImgUrl.newBuilder().addPathSegment(`${pad2(pageNum)}.webp`).build();

      const res = await this.client.head(imgUrl.toString(), undefined, { ensureSuccess: false });
      const isSuccess = res.isSuccessful;
      const contentType = res.header("Content-Type") ?? "";

      if (isSuccess && contentType.startsWith("image")) {
        pages.push(new Page(pageNum - 1, "", imgUrl.toString()));
        pageNum++;
      } else {
        break;
      }
    }
    return pages;
  }

  // ============================== Utilities =============================
  private async fetchLibrary(): Promise<LibraryEntry[]> {
    return (await this.client.get(`${this.baseUrl}/manga.json`)).parseAs<LibraryEntry[]>();
  }

  private async findEntry(seriesId: string): Promise<LibraryEntry> {
    const entry = (await this.fetchLibrary()).find((it) => it.id === seriesId);
    if (!entry) throw new Error(`Series not found: ${seriesId}`);
    return entry;
  }
}
