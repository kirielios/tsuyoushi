// Port of keiyoushi/extensions-source lib-multisrc/hwalumi/Hwalumi.kt
import {
  Base64,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ago,
  distinctBy,
  isNotBlank,
  toHttpUrl,
  trimStart,
  urlWithoutDomain,
  type Document,
  type Filter,
} from "../../sdk/index.ts";
import { Genre, GenreListFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

const firstInstance = <T>(filters: FilterList, cls: new (...args: never[]) => T): T | undefined => filters.find((it): it is Filter & T => it instanceof cls) as T | undefined;

export abstract class Hwalumi extends KeiSource {
  override async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/all-series?sort=popular&lang=id&page=${page}`)).asJsoup();
    return this.parseMangaList(document, page);
  }

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/all-series?sort=latest&lang=id&page=${page}`)).asJsoup();
    return this.parseMangaList(document, page);
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const sortFilter = firstInstance(filters, SortFilter)?.getValue() ?? "latest";
    const statusFilter = firstInstance(filters, StatusFilter)?.getValue() ?? "";
    const typeFilter = firstInstance(filters, TypeFilter)?.getValue() ?? "";
    const genreFilter = firstInstance(filters, GenreListFilter)?.getIncluded() ?? "";

    const url = toHttpUrl(`${this.baseUrl}/browse`).newBuilder();
    if (isNotBlank(query)) url.addQueryParameter("q", query);
    url.addQueryParameter("sort", sortFilter);
    if (statusFilter) url.addQueryParameter("status", statusFilter);
    if (typeFilter) url.addQueryParameter("type", typeFilter);
    if (genreFilter) url.addQueryParameter("genre", genreFilter);
    url.addQueryParameter("lang", "id");
    url.addQueryParameter("page", String(page));

    const document = (await this.client.get(url.build().toString())).asJsoup();
    return this.parseMangaList(document, page);
  }

  private parseMangaList(document: Document, page: number): MangasPage {
    const mangas = distinctBy(
      document.select('a[href^="/comic/"]:has(img:not([src*="flagcdn"]))').flatMap((element) => {
        const img = element.selectFirst("img");
        if (!img) return [];
        const title = isNotBlank(img.attr("alt")) ? img.attr("alt") : element.text().trim();
        if (!isNotBlank(title)) return [];

        const manga = SManga.create();
        manga.title = title;
        manga.thumbnail_url = img.attr("abs:src");
        manga.url = this.mangaSlug(element.attr("abs:href"));
        return [manga];
      }),
      (it) => it.url,
    );

    const hasNextPage = document.select(`a[href*="page=${page + 1}"]`).length > 0;
    return new MangasPage(mangas, hasNextPage);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.host !== new URL(this.baseUrl).host || !["comic", "komik"].includes(segments[0])) return null;
    const slug = segments[1];
    if (!isNotBlank(slug)) return null;
    const probe = SManga.create();
    probe.url = slug;
    const manga = (await this.fetchMangaUpdate(probe, [], true, true)).manga;
    manga.initialized = true;
    return manga;
  }

  private mangaSlug(url: string): string {
    return toHttpUrl(url.startsWith("http") ? url : `${this.baseUrl}/${trimStart(url, "/")}`)
      .pathSegments.filter((it) => it !== "")
      .at(-1)!;
  }

  private mangaUrl(url: string): string {
    return `${this.baseUrl}/comic/${this.mangaSlug(url)}`;
  }

  override getMangaUrl(manga: SManga): string {
    return this.mangaUrl(manga.url);
  }

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.mangaUrl(manga.url))).asJsoup();
    return new SMangaUpdate(this.parseMangaDetails(manga, document), this.parseChapterList(document));
  }

  private parseMangaDetails(manga: SManga, document: Document): SManga {
    const details = SManga.create();
    details.url = manga.url;
    details.title = document.selectFirst("h1")?.text()?.trim() ?? manga.title;
    details.thumbnail_url = document.selectFirst('aside img[src*="/cover"]')?.attr("abs:src") ?? manga.thumbnail_url;
    const encoded = document.selectFirst("div[data-sr]")?.attr("data-sr");
    details.description = (isNotBlank(encoded) ? this.decodeBase64(encoded) : null) ?? (document.selectFirst("p.text-sm")?.text()?.trim() || undefined);
    const notUpdating = (s: string | undefined) => (s != null && s.toLowerCase() === "updating" ? undefined : s);
    details.author = notUpdating(document.selectFirst("div:has(> span:containsOwn(Author)) > span:last-child")?.text());
    details.artist = notUpdating(document.selectFirst("div:has(> span:containsOwn(Artist)) > span:last-child")?.text());
    details.genre = [
      ...new Set(
        document
          .select('a[href*="genre="]')
          .map((it) => it.text().trim())
          .filter((it) => isNotBlank(it)),
      ),
    ].join(", ");
    switch (document.selectFirst("div:has(> div:containsOwn(Status)) > div:last-child")?.text()?.trim()?.toLowerCase()) {
      case "completed":
      case "tamat":
        details.status = SManga.COMPLETED;
        break;
      case "ongoing":
      case "berjalan":
        details.status = SManga.ONGOING;
        break;
      case "hiatus":
        details.status = SManga.ON_HIATUS;
        break;
      default:
        details.status = SManga.UNKNOWN;
    }
    return details;
  }

  private parseChapterList(document: Document): SChapter[] {
    return document.select('a[href*="/read/"][data-chapter]').map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.attr("abs:href"));
      chapter.name = element.selectFirst('span.text-sm, span[class*="font-semibold"]')?.text()?.trim() ?? element.text().trim();
      const num = element.attr("data-chapter").trim();
      chapter.chapter_number = num && !isNaN(Number(num)) ? Number(num) : -1;
      const dateStr = element.selectFirst('span.tabular-nums, span[class*="tabular-nums"]')?.text()?.trim();
      chapter.date_upload = this.parseRelativeDate(dateStr);
      return chapter;
    });
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    return this.documentImages((await this.client.get(this.baseUrl + chapter.url)).asJsoup());
  }

  private documentImages(document: Document): Page[] {
    return document
      .select('img[alt^="Page "]')
      .map((it) => it.attr("abs:src"))
      .filter((it) => isNotBlank(it) && !it.includes("/api/image/p/"))
      .map((imageUrl, index) => new Page(index, "", imageUrl));
  }

  private decodeBase64(encoded: string): string | null {
    try {
      let value = encoded.trim();
      const remainder = value.length % 4;
      if (remainder !== 0) value += "=".repeat(4 - remainder);
      const out = new TextDecoder().decode(Base64.decode(value)).trim();
      return isNotBlank(out) ? out : null;
    } catch {
      return null;
    }
  }

  private parseRelativeDate(dateStr: string | null | undefined): number {
    if (!isNotBlank(dateStr)) return 0;
    const trimmed = dateStr.toLowerCase().trim();
    if (trimmed === "baru saja") return Date.now();

    const m = /\d+/.exec(trimmed);
    if (!m) return 0;
    const number = Number(m[0]);

    if (trimmed.includes("detik")) return ago(number, "seconds");
    if (trimmed.includes("menit")) return ago(number, "minutes");
    if (trimmed.includes("jam")) return ago(number, "hours");
    if (trimmed.includes("hari")) return ago(number, "days");
    if (trimmed.includes("minggu")) return ago(number * 7, "days");
    if (trimmed.includes("bulan")) return ago(number, "months");
    if (trimmed.includes("tahun")) return ago(number, "years");
    return 0;
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/browse`)).asJsoup();
    const genres = distinctBy(
      document.select("label[data-bf-genre-name] input.bf-genre-cb[value]").flatMap((input) => {
        const value = input.attr("value").trim();
        const name = input.parent()?.selectFirst("span.truncate")?.text()?.trim();
        if (name == null) return [];
        return !isNotBlank(value) || !isNotBlank(name) ? [] : [{ name, value }];
      }),
      (it) => it.value,
    );
    if (!genres.length) throw new Error("Failed to fetch genres");
    return { genres };
  }

  override getFilterList(data: unknown = null): FilterList {
    const raw = (data as { genres?: { name?: string; value?: string }[] } | null)?.genres;
    const genres = raw?.flatMap((map) => (map.name != null && map.value != null ? [new Genre(map.name, map.value)] : []));

    return FilterList(new SortFilter(), new StatusFilter(), new TypeFilter(), ...(genres?.length ? [new GenreListFilter(genres)] : []));
  }
}
