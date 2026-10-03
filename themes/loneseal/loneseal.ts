// Port of keiyoushi/extensions-source lib-multisrc/loneseal/LoneSeal.kt (with Dto.kt and RelatedKeywords.kt)
import {
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  distinctBy,
  substringAfterLast,
  toHttpUrl,
  tryParseInstant,
  type Filter,
  type HttpUrlBuilder,
} from "../../sdk/index.ts";
import {
  CheckBoxFilter,
  ColorFilter,
  GenreFilter,
  OrderFilter,
  ReadingFilter,
  SelectFilter,
  SortFilter,
  StatusFilter,
  TextFilter,
  TypeFilter,
  colorOptions,
  genreOptions,
  isUriQueryFilter,
  orderOptions,
  readingOptions,
  seriesTagOptions,
  sortOptions,
  statusOptions,
  typeOptions,
} from "./filters.ts";

export class UrlLayout {
  private constructor(
    private readonly mangaPrefix: string,
    private readonly chapterPrefix: string,
  ) {}
  static readonly SLUG = new UrlLayout("", "/comic/");
  static readonly LEGACY_COMIC = new UrlLayout("/comic/", "/comic/");
  static readonly LEGACY_ROOT = new UrlLayout("/", "/comic/");
  static readonly LEGACY_SERIES = new UrlLayout("/series/", "/series/");

  mangaUrl(slug: string): string {
    return `${this.mangaPrefix}${slug}`;
  }
  chapterUrl(seriesSlug: string, chapterSlug: string): string {
    return `${this.chapterPrefix}${seriesSlug}/chapter/${chapterSlug}`;
  }
}

// ---- Dto.kt
interface SearchResponseDto {
  data: MangaDto[];
  total_pages: number;
}
interface MangaDto {
  title: string;
  slug: string;
  poster_image_url?: string | null;
}
interface GenreDto {
  name: string;
  slug: string;
}
interface SeriesDetailDto {
  title: string;
  slug: string;
  synopsis?: string | null;
  poster_image_url?: string | null;
  comic_status?: string | null;
  author_name?: string | null;
  artist_name?: string | null;
  primary_genre?: string | null;
  genres: GenreDto[];
  units: ChapterDto[];
}
interface ChapterDto {
  slug: string;
  number: string;
  title?: string | null;
  created_at?: string | null;
}
export interface ChapterPagesResponseDto {
  chapter: ChapterPagesDto;
}
export interface ChapterPagesDto {
  login_required?: boolean | null; // loginRequired
  password_required?: boolean; // passwordRequired
  pages?: { image_url: string }[];
}
interface HomeSectionsDto {
  latest_comic_updates?: { series_title: string; series_slug: string; poster_image_url?: string | null }[];
}

const toMangasPage = (dto: SearchResponseDto, page: number, urlLayout: UrlLayout) => new MangasPage(dto.data.map((it) => mangaToSManga(it, urlLayout)), page < dto.total_pages);

function mangaToSManga(dto: MangaDto, urlLayout: UrlLayout): SManga {
  const manga = SManga.create();
  manga.url = urlLayout.mangaUrl(dto.slug);
  manga.title = dto.title.trim();
  manga.thumbnail_url = dto.poster_image_url ?? undefined;
  return manga;
}

function detailToSManga(dto: SeriesDetailDto, urlLayout: UrlLayout): SManga {
  const manga = SManga.create();
  manga.url = urlLayout.mangaUrl(dto.slug);
  manga.title = dto.title.trim();
  manga.thumbnail_url = dto.poster_image_url ?? undefined;
  manga.author = dto.author_name ?? undefined;
  manga.artist = dto.artist_name ?? undefined;
  manga.description = dto.synopsis != null ? toMarkdownDescription(dto.synopsis) : undefined;
  const genres = [...(dto.primary_genre != null ? [dto.primary_genre] : []), ...dto.genres.map((it) => it.name)];
  manga.genre = [...new Set(genres)].join(", ") || undefined;
  manga.status = parseStatus(dto.comic_status);
  return manga;
}

function chapterToSChapter(dto: ChapterDto, seriesSlug: string, urlLayout: UrlLayout, includeChapterTitle: boolean): SChapter {
  const chapter = SChapter.create();
  chapter.url = urlLayout.chapterUrl(seriesSlug, dto.slug);
  chapter.name = `Chapter ${formatChapterNumber(dto.number)}`;
  if (includeChapterTitle && dto.title != null) chapter.name += ` - ${dto.title}`;
  const n = dto.number.trim() ? Number(dto.number) : NaN;
  chapter.chapter_number = Number.isNaN(n) ? -1 : n;
  chapter.date_upload = tryParseInstant(dto.created_at);
  return chapter;
}

const synopsisAnchorRegex = /<a\s+href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;

const toMarkdownDescription = (s: string) =>
  s
    .replace(synopsisAnchorRegex, (_, href: string, text: string) => `[${text.trim()}](${href.trim()})`)
    .replaceAll("<strong>", "**")
    .replaceAll("</strong>", "**")
    .replaceAll("<p>", "\n\n")
    .replaceAll("</p>", "\n\n")
    .replaceAll("<", "\\<")
    .replaceAll(">", "\\>");

const formatChapterNumber = (number: string) => (number.endsWith(".00") ? number.slice(0, -3) : number);

function parseStatus(s: string | null | undefined): number {
  switch (s?.toLowerCase()) {
    case "ongoing":
      return SManga.ONGOING;
    case "completed":
      return SManga.COMPLETED;
    case "hiatus":
      return SManga.ON_HIATUS;
    default:
      return SManga.UNKNOWN;
  }
}

// ---- RelatedKeywords.kt
const fillerWords = new Set(
  `adalah akan akankah akhirnya always antara apakah atas atau author baca bagai bagaimana bagi bahkan bahwa banyak baru before begins begitu beli belum benar
berada bernama bertemu besar biasa bisa bukan cantik cara chapter chapters com comic commotion dalam dan dapat dapatkan dari datang death dengan depan dewa
dia diam dimana diri diriku dirinya dunia emotion enam episode feel filled gadis game gmail haeilnox hampir hanya hari harus hidup hidupmu hidupnya high
href http https ingin ini isi itu jadi jika jiwa juga junior justru karena kecil kedua kehidupan kekuatan kelas kembali kemudian kenyataan kepada
ketika kini kisah klik komik kuat lagi lain laki lalu langsung lebih life link list longer luka mailto maka malam mana manga manusia masa masih masing
mau melainkan melakukan melihat memang membuat memiliki mendapatkan mengenai menggunakan menjadi menjalani mereka merupakan monster mulai muncul mungkin murid
mysterious nama namun naver nothing oleh online orang original pada paling para pemuda pernah read romance saat saja salah saling sama sampai sang sangat
satu satunya saya school sebagai sebelumnya sebuah secara sedang sedangkan segala sehingga sejak sekadar sekaligus sekarang sekolah selalu selama seluruh semakin
semua semuanya senior seorang seperti series serta sesuatu setelah setiap seumur si sinopsis sistem story student studio subjek sudah tahun tangan tanpa tapi
telah teman tempat tengah tentang terhadap terlalu tersebut tersisa tetapi thriller tiba tidak title tubuh tulisan under untuk update video waktu wanita
webtoon webtoons with www yang year`.split(/\s+/),
);

function relatedKeywords(s: string): string[] {
  const prose = s.replace(/<[^>]*>/g, " ");
  const scanned = [...prose.matchAll(/[A-Za-z]+/g)].map((m) => [m.index, m[0]] as const);
  const groups = new Map<string, (readonly [number, string])[]>();
  for (const entry of scanned) {
    const word = entry[1];
    if (word.length < 4 || word === word.toUpperCase() || fillerWords.has(word.toLowerCase())) continue;
    const key = word.toLowerCase();
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(entry);
  }
  const candidates = [...groups.values()].map((occurrences) => ({
    value: occurrences[0][1],
    occurrences: occurrences.length,
    common: occurrences.some(([, word]) => word[0] === word[0].toLowerCase()),
    firstIndex: occurrences[0][0],
  }));
  return candidates.sort((a, b) => Number(b.common) - Number(a.common) || b.occurrences - a.occurrences || a.firstIndex - b.firstIndex).map((it) => it.value);
}

function interleave<T>(lists: T[][]): T[] {
  if (!lists.length) return [];
  const out: T[] = [];
  const max = Math.max(...lists.map((it) => it.length));
  for (let index = 0; index < max; index++) for (const list of lists) if (index < list.length) out.push(list[index]);
  return out;
}

/** String.CASE_INSENSITIVE_ORDER */
const titleComparator = (a: SManga, b: SManga) => {
  const x = a.title.toUpperCase().toLowerCase();
  const y = b.title.toUpperCase().toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export abstract class LoneSeal extends KeiSource {
  protected get apiUrl(): string {
    const base = toHttpUrl(this.baseUrl);
    // ponytail: last two labels stand in for OkHttp's public-suffix topPrivateDomain(); fine for these .com/.org/.space hosts
    return `https://api.${base.host.split(".").slice(-2).join(".")}/api`;
  }

  protected urlLayout = UrlLayout.SLUG;
  protected mangaUrlDirectory = "comic";
  protected get overloadedGenres(): Set<string> {
    return new Set(["action", "adult", "drama", "fantasy", "romance", "smut"]);
  }
  protected includeChapterTitle = false;
  protected includeSeriesTagFilter = false;
  protected includeProjectOnlyFilter = false;

  override async getPopularManga(page: number): Promise<MangasPage> {
    const url = this.searchUrl(page, (b) => b.addQueryParameter("sort", "views").addQueryParameter("order", "desc"));
    return toMangasPage((await this.client.get(url)).parseAs<SearchResponseDto>(), page, this.urlLayout);
  }

  override async getLatestUpdates(_page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/comic/home-sections`)
      .newBuilder()
      .addQueryParameter("sections", "latest_comic_updates")
      .addQueryParameter("updateLimit", "240") // Default: 12, 35. Max: 35, 100, 720.
      .build();
    const response = (await this.client.get(url.toString())).parseAs<HomeSectionsDto>();
    return new MangasPage(
      (response.latest_comic_updates ?? []).map((it) => {
        const manga = SManga.create();
        manga.url = this.urlLayout.mangaUrl(it.series_slug);
        manga.title = it.series_title.trim();
        manga.thumbnail_url = it.poster_image_url ?? undefined;
        return manga;
      }),
      false,
    );
  }

  private searchUrl(page: number, query: (b: HttpUrlBuilder) => void): string {
    const b = toHttpUrl(`${this.apiUrl}/search`).newBuilder().addQueryParameter("type", "COMIC").addQueryParameter("limit", "20").addQueryParameter("page", String(page));
    query(b);
    return b.build().toString();
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const selectedSort = filters.find((it) => it instanceof SortFilter)?.selectedValue();
    const url = this.searchUrl(page, (b) => {
      if (query.trim()) b.addQueryParameter("q", query);
      filters.filter(isUriQueryFilter).forEach((it) => it.addToQuery(b));
    });
    const result = toMangasPage((await this.client.get(url)).parseAs<SearchResponseDto>(), page, this.urlLayout);

    if (selectedSort === "az") return new MangasPage([...result.mangas].sort(titleComparator), result.hasNextPage);
    if (selectedSort === "za") return new MangasPage([...result.mangas].sort((a, b) => titleComparator(b, a)), result.hasNextPage);
    return result;
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const segments = url.pathname.slice(1).split("/");
    if (segments[0] !== this.mangaUrlDirectory) return null;
    if (segments[2] === "chapter") return null;
    const slug = segments[1];
    if (slug == null) return null;
    const manga = detailToSManga((await this.client.get(`${this.apiUrl}/series/comic/${slug}`)).parseAs<SeriesDetailDto>(), this.urlLayout);
    manga.initialized = true;
    return manga;
  }

  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const detail = (await this.client.get(`${this.apiUrl}/series/comic/${this.mangaSlug(manga.url)}`)).parseAs<SeriesDetailDto>();
    return new SMangaUpdate(
      detailToSManga(detail, this.urlLayout),
      detail.units.map((it) => chapterToSChapter(it, detail.slug, this.urlLayout, this.includeChapterTitle)),
    );
  }

  override get supportsRelatedMangas() {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const slug = this.mangaSlug(manga.url);
    const detail = (await this.client.get(`${this.apiUrl}/series/comic/${slug}`)).parseAs<SeriesDetailDto>();
    const keywords = detail.synopsis != null ? relatedKeywords(detail.synopsis) : [];
    const genre = detail.genres.find((it) => !this.overloadedGenres.has(it.slug))?.slug;
    const results = await Promise.all([...keywords.slice(0, 2).map((keyword) => this.searchByKeyword(keyword)), ...(genre != null ? [this.searchByGenre(genre)] : [])]);
    return distinctBy(
      interleave(results).filter((it) => it.slug !== slug),
      (it) => it.slug,
    ).map((it) => mangaToSManga(it, this.urlLayout));
  }

  private async searchByKeyword(keyword: string): Promise<MangaDto[]> {
    return (await this.client.get(this.searchUrl(1, (b) => b.addQueryParameter("q", keyword)))).parseAs<SearchResponseDto>().data;
  }

  private async searchByGenre(genre: string): Promise<MangaDto[]> {
    return (await this.client.get(this.searchUrl(1, (b) => b.addQueryParameter("genre", genre)))).parseAs<SearchResponseDto>().data;
  }

  protected async configureChapterHeaders(headers: Headers): Promise<Headers> {
    return headers;
  }

  private chapterHeaders(): Promise<Headers> {
    return this.configureChapterHeaders(this.headersBuilder());
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const [seriesSlug, chapterSlug] = this.chapterParts(chapter.url);
    const dto = (await this.client.get(`${this.apiUrl}/series/comic/${seriesSlug}/chapter/${chapterSlug}`, await this.chapterHeaders())).parseAs<ChapterPagesResponseDto>();
    dto.chapter ??= {};
    const pages = this.toPageList(dto);
    if (!pages.length) this.onEmptyPages(dto);
    return pages;
  }

  protected onEmptyPages(_dto: ChapterPagesResponseDto): void {}

  protected toPageList(dto: ChapterPagesResponseDto): Page[] {
    return (dto.chapter.pages ?? []).map((page, index) => new Page(index, "", page.image_url));
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.apiUrl}/genres`)).parseAs<unknown>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const list: Filter[] = [
      new SortFilter(sortOptions),
      new OrderFilter(orderOptions),
      new StatusFilter(statusOptions),
      new GenreFilter(genreOptions(data, this.overloadedGenres)),
      new TypeFilter(typeOptions),
      new ColorFilter(colorOptions),
      new ReadingFilter(readingOptions),
    ];
    if (this.includeSeriesTagFilter) list.push(new SelectFilter("Tag", "series_tag", seriesTagOptions));
    if (this.includeProjectOnlyFilter) list.push(new CheckBoxFilter("Project Only", "project_only"));
    list.push(new TextFilter("Author", "author"), new TextFilter("Artist", "artist"), new TextFilter("Publisher", "publisher"));
    return list;
  }

  private mangaSlug(url: string): string {
    return substringAfterLast(url.replace(/^\/+|\/+$/g, ""), "/");
  }

  private chapterParts(url: string): [string, string] {
    const parts = url.replace(/^\/+|\/+$/g, "").split("/chapter/");
    return [substringAfterLast(parts[0], "/"), parts[1]];
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/${this.mangaUrlDirectory}/${this.mangaSlug(manga.url)}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    const [seriesSlug, chapterSlug] = this.chapterParts(chapter.url);
    return `${this.baseUrl}/${this.mangaUrlDirectory}/${seriesSlug}/chapter/${chapterSlug}`;
  }
}
