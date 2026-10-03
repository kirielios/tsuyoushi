// Port of keiyoushi/extensions-source src/en/mangalix/Mangalix.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, distinctBy, firstInstanceOrNull, type ClientBuilder } from "../../../sdk/index.ts";
import { GenreFilter, SortFilter, StatusFilter } from "./filters.ts";
import { isMangaDtoList, latestTimestamp, toMangaTimestamp, toSManga, type ChapterDto, type MangaDto } from "./dto.ts";
import { JsLiteralParser } from "./jsliteralparser.ts";

const ARCHIVE_CACHE_MS = 30 * 60 * 1000;
const CATALOG_START_REGEX = /\[\{id\s*:/g;
const WHITESPACE_REGEX = /\s+/;

const byDescending = <T>(list: T[], key: (t: T) => number | string): T[] => [...list].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));

export default class Mangalix extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    const host = new URL(this.baseUrl).host;
    return builder.rateLimit(2, 1000, (url) => url.host === host);
  }

  private get archiveHeaders(): Headers {
    const h = this.headersBuilder();
    h.set("Accept", "application/gzip");
    h.set("Accept-Encoding", "identity");
    return h;
  }

  private get imageHeaders(): Headers {
    const h = this.headersBuilder();
    h.set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
    return h;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage((await this.loadCatalog()).map((it) => toSManga(it, this.baseUrl)), false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    return new MangasPage(
      byDescending(await this.loadCatalog(), latestTimestamp).map((it) => toSManga(it, this.baseUrl)),
      false,
    );
  }

  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const statusFilter = firstInstanceOrNull(filters, StatusFilter);
    const sortFilter = firstInstanceOrNull(filters, SortFilter);
    const genreFilter = firstInstanceOrNull(filters, GenreFilter);
    const terms = query.trim().toLowerCase().split(WHITESPACE_REGEX).filter((it) => it.length > 0);

    let result = (await this.loadCatalog())
      .filter((manga) => terms.length === 0 || this.matchesTerms(manga, terms))
      .filter((manga) => statusFilter?.matches(manga.status) !== false)
      .filter((manga) => genreFilter?.matches(manga.genres) !== false);

    switch (sortFilter?.selected) {
      case SortFilter.LATEST:
        result = byDescending(result, latestTimestamp);
        break;
      case SortFilter.RATING:
        result = byDescending(result, (m) => m.rating);
        break;
      case SortFilter.TITLE:
        result = byDescending(result, (m) => m.title.toLowerCase());
        break;
      case SortFilter.RELEASE_YEAR:
        result = byDescending(result, (m) => m.releaseYear);
        break;
    }

    if (sortFilter?.ascending === true) result = [...result].reverse();

    return new MangasPage(result.map((it) => toSManga(it, this.baseUrl)), false);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new StatusFilter(), new SortFilter(), new GenreFilter());
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const segments = url.pathname.slice(1).split("/");
    if (segments[0] !== "manga") return null;
    const slug = segments[1];
    if (slug === undefined) return null;

    const found = (await this.loadCatalog()).find((it) => it.slug === slug);
    return found ? toSManga(found, this.baseUrl) : null;
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = manga.url;

    const updatedManga = fetchDetails
      ? (async () => {
          const found = (await this.loadCatalog()).find((it) => it.slug === slug);
          return found ? toSManga(found, this.baseUrl) : manga;
        })()
      : null;

    const updatedChapters = fetchChapters
      ? (async () =>
          distinctBy(await this.readChapters(slug), (it) => `${it.id}\u0000${it.number}`).map((chapter) => {
            const c = SChapter.create();
            const number = String(chapter.number).replace(/\.0$/, "");
            c.url = chapter.id;
            c.memo = { slug, number };
            c.name = chapter.title.trim() ? chapter.title : `Chapter ${number}`;
            c.chapter_number = chapter.number;
            c.date_upload = toMangaTimestamp(chapter.releaseDate);
            return c;
          }))()
      : null;

    const [m, c] = await Promise.all([updatedManga, updatedChapters]);
    return new SMangaUpdate(m ?? manga, c ?? chapters);
  }

  override getChapterUrl(chapter: SChapter): string {
    const slug = chapter.memo.slug as string;
    const number = chapter.memo.number as string;
    return `${this.baseUrl}/manga/${slug}/chapter/${number}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const slug = chapter.memo.slug as string | undefined;
    if (slug == null) throw new Error("Refresh chapter list");
    const number = Number(chapter.memo.number as string);
    const chapterId = chapter.url;

    const pages = (await this.readChapters(slug)).find((it) => it.id === chapterId && it.number === number)?.pages ?? [];
    return pages.map((imageUrl, index) => new Page(index, "", this.resolveImageUrl(imageUrl)));
  }

  override imageRequest(page: Page) {
    return { url: page.imageUrl!, headers: this.imageHeaders };
  }

  private async loadCatalog(): Promise<MangaDto[]> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();
    const scriptUrl = document.selectFirst("script[type=module][src*=assets/main-], script[src*=assets/main-]")?.absUrl("src") || null;
    if (!scriptUrl) throw new Error("Main script not found");

    const script = (await this.client.get(scriptUrl)).text();

    for (const match of script.matchAll(CATALOG_START_REGEX)) {
      let element: unknown;
      try {
        element = new JsLiteralParser(script, match.index).parse();
      } catch {
        continue;
      }
      if (!isMangaDtoList(element)) continue;

      if (element.length > 0 && element.every((it) => it.slug.trim() !== "" && it.title.trim() !== "")) {
        return distinctBy(element, (it) => it.slug);
      }
    }

    throw new Error("Manga catalog not found");
  }

  private matchesTerms(manga: MangaDto, terms: string[]): boolean {
    const searchable = `${manga.title} ${manga.author} ${manga.slug}`.toLowerCase();
    return terms.every((it) => searchable.includes(it));
  }

  // ARCHIVE_CACHE_CONTROL: OkHttp's cache is not available, keep the parsed archive for 30 minutes instead
  private archive?: { at: number; data: Record<string, ChapterDto[]> };

  private async readChapters(slug: string): Promise<ChapterDto[]> {
    if (!this.archive || Date.now() - this.archive.at > ARCHIVE_CACHE_MS) {
      const response = await this.client.get(`${this.baseUrl}/chapters.json.gz`, this.archiveHeaders);
      const stream = new Blob([response.bytes() as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
      const text = await new globalThis.Response(stream).text();
      this.archive = { at: Date.now(), data: JSON.parse(text) as Record<string, ChapterDto[]> };
    }
    const list = this.archive.data[slug];
    if (!Array.isArray(list)) return [];
    return list.filter((c) => typeof c.id === "string" && c.id.trim() !== "").map((c) => ({ id: c.id, number: c.number ?? 0, title: c.title ?? "", pages: c.pages ?? [], releaseDate: c.releaseDate ?? null }));
  }

  private resolveImageUrl(s: string): string {
    if (s.startsWith("$TEMP")) return s.replace("$TEMP", () => "https://temp.compsci88.com");
    if (s.startsWith("$HOT")) return s.replace("$HOT", () => "https://scans-hot.planeptune.us");
    if (s.startsWith("$LST")) return s.replace("$LST", () => "https://scans.lastation.us");
    if (s.startsWith("$LOW")) return s.replace("$LOW", () => "https://official.lowee.us");
    if (s.startsWith("$MFK")) return s.replace("$MFK", () => "https://images.mangafreak.me");
    if (s.startsWith("/cdn-readmanga/")) return `https://cdn.readmanga.cc${s.slice("/cdn-readmanga".length)}`;
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("/")) return `${this.baseUrl}${s}`;
    return s;
  }
}
