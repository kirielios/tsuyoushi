// Port of keiyoushi/extensions-source src/all/leagueoflegends/LOLUniverse.kt (+ LOLModels.kt), libVersion 1.4
import {
  GET,
  HttpSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  substringAfter,
  substringBefore,
  tryParseInstant,
  type FilterList,
  type Request,
  type Response,
} from "../../../sdk/index.ts";

// ---- LOLModels.kt
interface LOLImage {
  uri: string;
}
interface LOLChampion {
  name: string;
}
interface LOLComic {
  title?: string | null;
  subtitle?: string | null;
  index?: number | null;
  url?: string | null;
  description?: string | null;
  background?: LOLImage | null;
  "featured-champions"?: LOLChampion[] | null;
}
interface LOLData {
  data: LOLComic[];
}
interface LOLHub {
  sections: { series: LOLData; "one-shots": LOLData };
}
interface LOLIssues {
  issues: LOLComic[];
}
interface LOLPages {
  "staging-date": string;
  "desktop-pages": LOLImage[][];
}

/** LOLComic.toString() */
function comicToString(c: LOLComic): string {
  if (c.url == null) throw new Error("Empty URL");
  return substringAfter(c.url, "/comic/");
}

const UNIVERSE_URL = "https://universe.leagueoflegends.com";
const MEEPS_URL = "https://universe-meeps.leagueoflegends.com/v1";
const COMICS_URL = "https://universe-comics.leagueoflegends.com/comics";

export default class LOLUniverse extends HttpSource {
  private get siteLang(): string {
    return substringBefore(substringAfter(this.baseUrl, "leagueoflegends.com/"), "/comic/");
  }

  override get supportsLatest() {
    return false;
  }

  private readonly pageCache = new Map<string, Page[]>();

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.set("Origin", UNIVERSE_URL);
    h.set("Referer", `${UNIVERSE_URL}/`);
    return h;
  }

  protected popularMangaRequest(_page: number): Request {
    return GET(`${MEEPS_URL}/${this.siteLang}/comics/index.json`, this.headers);
  }

  protected override chapterListRequest(manga: SManga): Request {
    return GET(`${MEEPS_URL}/${this.siteLang}/comics/${manga.url}/index.json`, this.headers);
  }

  protected override pageListRequest(chapter: SChapter): Request {
    return GET(`${COMICS_URL}/${this.siteLang}/${chapter.url}/index.json`, this.headers);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const hub = this.decode<LOLHub>(response);
    const mangas: SManga[] = [];
    for (const it of [...hub.sections.series.data, ...hub.sections["one-shots"].data]) {
      if (it.title == null) continue;
      const manga = SManga.create();
      manga.title = it.title;
      manga.url = comicToString(it);
      if (it.description == null) throw new Error("NullPointerException"); // description!!
      manga.description = this.clean(it.description);
      manga.thumbnail_url = it.background != null ? it.background.uri : "null"; // Kotlin's null.toString()
      manga.genre = it.subtitle ?? it["featured-champions"]?.map((c) => c.name).join(", ");
      mangas.push(manga);
    }
    return new MangasPage(mangas, false);
  }

  protected override async chapterListParse(response: Response): Promise<SChapter[]> {
    const chapters: SChapter[] = [];
    for (const it of [...this.decode<LOLIssues>(response).issues].reverse()) {
      const chapter = SChapter.create();
      chapter.name = it.title!;
      chapter.url = comicToString(it);
      chapter.chapter_number = it.index ?? -1;
      await this.fetchPageListInto(chapter);
      chapters.push(chapter);
    }
    return chapters;
  }

  override async fetchSearchManga(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const result = this.popularMangaParse(await this.executeSuccess(this.popularMangaRequest(page)));
    const q = query.toLowerCase();
    return new MangasPage(
      result.mangas.filter((it) => it.title.toLowerCase().includes(q) || (it.genre?.toLowerCase().includes(q) ?? false)),
      result.hasNextPage,
    );
  }

  override async fetchMangaDetails(manga: SManga): Promise<SManga> {
    manga.initialized = true;
    return manga;
  }

  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    if (!manga.url.includes("/")) return super.fetchChapterList(manga);
    const chapter = SChapter.create();
    chapter.url = manga.url;
    chapter.name = "One Shot";
    chapter.chapter_number = 0;
    await this.fetchPageListInto(chapter);
    return [chapter];
  }

  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    return this.pageCache.get(chapter.url) ?? [];
  }

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}${chapter.url}`;
  }

  protected latestUpdatesRequest(_page: number): Request {
    throw new Error("UnsupportedOperationException");
  }
  protected searchMangaRequest(_page: number, _query: string, _filters: FilterList): Request {
    throw new Error("UnsupportedOperationException");
  }
  override mangaDetailsRequest(_manga: SManga): Request {
    throw new Error("UnsupportedOperationException");
  }
  protected latestUpdatesParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }
  protected searchMangaParse(_response: Response): MangasPage {
    throw new Error("UnsupportedOperationException");
  }
  protected mangaDetailsParse(_response: Response): SManga {
    throw new Error("UnsupportedOperationException");
  }
  protected pageListParse(_response: Response): Page[] {
    throw new Error("UnsupportedOperationException");
  }
  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  private decode<T>(response: Response): T {
    return JSON.parse(response.text()) as T;
  }

  private clean(s: string): string {
    return s.replaceAll("</p> ", "</p>").replaceAll("</p>", "\n").replaceAll("<p>", "");
  }

  /** SChapter.fetchPageList(): the chapter date is only available in the page list */
  private async fetchPageListInto(chapter: SChapter): Promise<void> {
    const pages = this.decode<LOLPages>(await this.client.execute(this.pageListRequest(chapter)));
    chapter.date_upload = tryParseInstant(pages["staging-date"]);
    this.pageCache.set(
      chapter.url,
      pages["desktop-pages"].flat().map((img, idx) => new Page(idx, "", img.uri)),
    );
  }
}
