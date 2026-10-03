// Port of keiyoushi/extensions-source src/id/komiknesia/KomikNesia.kt
import { Base64, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, aesCbcDecrypt, parseAs, toHttpUrl, utf8, type Response } from "../../../sdk/index.ts";
import { Genre, GenreFilter, OrderFilter, StatusFilter } from "./filters.ts";

// Dto.kt
interface EncryptedEnvelopeDto {
  data: string;
  time: number;
}

interface PayloadDto<T> {
  data: T;
  meta?: MetaDto | null;
}

interface MetaDto {
  page: number;
  total_pages: number;
}

interface MangaDto {
  title: string;
  slug: string;
  alternative_name?: string | null;
  author?: string | null;
  sinopsis?: string | null;
  cover?: string | null;
  status?: string | null;
  genres?: GenreDto[] | null;
  chapters?: ChapterDto[] | null;
}

const PARAGRAPH_REGEX = /<\/?p\s*\/?>/g;

function mangaToSManga(dto: MangaDto): SManga {
  const manga = SManga.create();
  manga.url = dto.slug;
  manga.title = dto.title;
  manga.thumbnail_url = dto.cover ?? undefined;
  manga.author = dto.author ?? undefined;
  let description = "";
  if (dto.sinopsis != null) description += dto.sinopsis.replace(PARAGRAPH_REGEX, "").trim();
  if (dto.alternative_name != null && dto.alternative_name.trim() !== "") {
    if (description) description += "\n\n";
    description += "Alternative Names:";
    dto.alternative_name
      .split(",")
      .map((it) => it.trim())
      .filter((it) => it)
      .forEach((it) => (description += `\n${it}`));
  }
  manga.description = description;
  manga.genre = (dto.genres === undefined ? [] : dto.genres)?.map((it) => it.name).join(", ");
  switch (dto.status?.toLowerCase()) {
    case "ongoing":
      manga.status = SManga.ONGOING;
      break;
    case "completed":
      manga.status = SManga.COMPLETED;
      break;
    case "hiatus":
      manga.status = SManga.ON_HIATUS;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  return manga;
}

interface ChapterDto {
  number: string;
  title: string;
  slug: string;
  created_at?: DateDto | null;
  scheduled_release_at?: DateDto | null;
}

function chapterToSChapter(dto: ChapterDto): SChapter {
  const chapter = SChapter.create();
  chapter.url = dto.slug;
  const releaseTime = (dto.scheduled_release_at?.time ?? dto.created_at?.time ?? 0) * 1000;
  // Lock logic disabled: despite being marked as premium/locked on the website,
  // locked chapters can still be fetched directly from the backend API without authorization.
  chapter.name = dto.title;
  const n = Number(dto.number);
  chapter.chapter_number = dto.number.trim() !== "" && !Number.isNaN(n) ? n : -1;
  chapter.date_upload = releaseTime;
  return chapter;
}

interface DateDto {
  time: number;
}

interface PageListDto {
  images: string[];
}

interface GenreDto {
  id: number;
  name: string;
}

const removePrefix = (s: string, p: string) => (s.startsWith(p) ? s.slice(p.length) : s);

export default class KomikNesia extends KeiSource {
  private readonly apiUrl = "https://api-be.komiknesia.my.id/api";

  /** The private Response.parseAs<T>() override: decrypts `{"encrypted":true}` envelopes first. */
  private async parseAs<T>(response: Response): Promise<T> {
    const bodyString = response.text();
    if (bodyString.includes('"encrypted":true') || bodyString.includes('"encrypted": true')) {
      const envelope = parseAs<EncryptedEnvelopeDto>(bodyString);
      return parseAs<T>(await this.decrypt(envelope.data, envelope.time));
    }
    return parseAs<T>(bodyString);
  }

  private async decrypt(encryptedData: string, time: number): Promise<string> {
    try {
      // String.format(Locale.US, "%.8f", time / 32.0).padEnd(32, '0').take(32)
      const keyStr = (time / 32.0).toFixed(8).padEnd(32, "0").slice(0, 32);
      let raw: Uint8Array;
      try {
        raw = Base64.decode(encryptedData);
      } catch {
        throw new Error("Failed to decode base64 encrypted data");
      }
      if (raw.length < 16) throw new Error("Encrypted data too short");
      const iv = raw.slice(0, 16);
      const ciphertext = raw.slice(16);
      return new TextDecoder().decode(await aesCbcDecrypt(utf8(keyStr), iv, ciphertext));
    } catch (e) {
      throw new Error("Failed to decrypt API response", { cause: e });
    }
  }

  // ===============================
  // Popular
  // ===============================

  getPopularManga(page: number): Promise<MangasPage> {
    const order = new OrderFilter();
    order.state = 2;
    return this.getSearchMangaList(page, "", FilterList(order));
  }

  // ===============================
  // Latest
  // ===============================

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", FilterList());
  }

  // ===============================
  // Search
  // ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.apiUrl}/contents`).newBuilder();
    url.addQueryParameter("page", String(page));

    if (query.trim()) url.addQueryParameter("q", query);

    for (const filter of filters) {
      if (filter instanceof GenreFilter) {
        filter.state.filter((it) => it.state).forEach((it) => url.addQueryParameter("genre[]", it.id));
      } else if (filter instanceof StatusFilter) {
        if (filter.state !== 0) url.addQueryParameter("status", filter.toUriPart());
      } else if (filter instanceof OrderFilter) {
        if (filter.state !== 0) url.addQueryParameter("orderBy", filter.toUriPart());
      }
    }

    const payload = await this.parseAs<PayloadDto<MangaDto[]>>(await this.client.get(url.build().toString()));
    const mangas = payload.data.map(mangaToSManga);
    const hasNextPage = payload.meta ? payload.meta.page < payload.meta.total_pages : false;
    return new MangasPage(mangas, hasNextPage);
  }

  // ===============================
  // Details
  // ===============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const slug = removePrefix(removePrefix(manga.url, "/komik/"), "/");
    const payload = await this.parseAs<PayloadDto<MangaDto>>(await this.client.get(`${this.apiUrl}/comic/${slug}`));
    const details = mangaToSManga(payload.data);
    details.initialized = true;
    return new SMangaUpdate(details, payload.data.chapters?.map(chapterToSChapter) ?? []);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    try {
      if (!url.hostname.endsWith("komiknesiaku.com")) return null;
      const pathSegments = url.pathname
        .slice(1)
        .split("/")
        .filter((it) => it);
      if (pathSegments[0] !== "komik") return null;
      const slug = pathSegments[1];
      if (slug == null) return null;
      const payload = await this.parseAs<PayloadDto<MangaDto>>(await this.client.get(`${this.apiUrl}/comic/${slug}`));
      const manga = mangaToSManga(payload.data);
      manga.initialized = true;
      return manga;
    } catch {
      return null;
    }
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/komik/${removePrefix(removePrefix(manga.url, "/komik/"), "/")}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/view/${removePrefix(removePrefix(chapter.url, "/view/"), "/")}`;
  }

  // ===============================
  // Pages
  // ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const slug = removePrefix(removePrefix(chapter.url, "/view/"), "/");
    const payload = await this.parseAs<PayloadDto<PageListDto>>(await this.client.get(`${this.apiUrl}/chapters/slug/${slug}`));
    return payload.data.images.map((img, idx) => new Page(idx, "", img));
  }

  // ===============================
  // Filters
  // ===============================

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return this.parseAs<unknown>(await this.client.get(`${this.apiUrl}/contents/genres`));
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = (data as PayloadDto<GenreDto[]> | null)?.data?.map((it) => new Genre(it.name, String(it.id)));

    const list: FilterList = [new OrderFilter(), new StatusFilter()];
    if (genres?.length) list.push(new GenreFilter(genres));
    return list;
  }
}
