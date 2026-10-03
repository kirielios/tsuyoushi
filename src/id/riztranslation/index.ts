// Port of keiyoushi/extensions-source src/id/riztranslation/Riztranslation.kt
import {
  DateTimeFormatter,
  FilterList,
  GET,
  HttpSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  distinctBy,
  parseAs,
  substringAfterLast,
  toHttpUrl,
  toHttpUrlOrNull,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { GenreFilter, HasChapterFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

// Dto.kt
interface BookDto {
  id: number;
  judul: string;
  cover?: string | null;
  status?: string | null;
  author?: string | null;
  artist?: string | null;
  synopsis?: string | null;
  genres?: BookGenreDto[] | null;
}

interface LatestChapterDto {
  Book?: BookDto | null;
}

interface BookGenreDto {
  genre?: GenreDto | null;
}

interface GenreDto {
  nama?: string | null;
}

interface ChapterDto {
  id: number;
  bookId: number;
  chapter?: number | null;
  nama?: string | null;
  created_at?: string | null;
  isigambar?: string | null;
}

const PREFIX_ID_SEARCH = "id:";

export default class Riztranslation extends HttpSource {
  private readonly apiUrl = "https://uefnaojxivvxeamljskn.supabase.co/rest/v1";

  override get supportsLatest() {
    return true;
  }

  // SimpleDateFormat parses in the system zone
  private readonly dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS", Locale.ROOT);
  private readonly dateFormatNoMs = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);

  private _apiHeaders?: Headers;
  private get apiHeaders(): Headers {
    if (!this._apiHeaders) {
      const h = this.headersBuilder();
      h.append(
        "apikey",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlZm5hb2p4aXZ2eGVhbWxqc2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3MTU5MjksImV4cCI6MjA2MzI5MTkyOX0._lEBN5puTvATwtYodg4zbcoTwg0ss3j2BebD8WoHt9A",
      );
      this._apiHeaders = h;
    }
    return this._apiHeaders;
  }

  // ========================= Popular =========================
  protected popularMangaRequest(page: number): Request {
    const offset = (page - 1) * 20;
    return GET(`${this.apiUrl}/Book?select=id,judul,cover&type=not.ilike.*novel*&order=id.desc&offset=${offset}&limit=20`, this.apiHeaders);
  }

  protected popularMangaParse(response: Response): MangasPage {
    const books = response.parseAs<BookDto[]>();
    const hasNextPage = books.length === 20;

    const mangaList = books.map((book) => {
      const manga = SManga.create();
      manga.url = String(book.id);
      manga.title = book.judul;
      manga.thumbnail_url = book.cover ?? undefined;
      return manga;
    });
    return new MangasPage(mangaList, hasNextPage);
  }

  // ========================= Latest =========================
  protected latestUpdatesRequest(page: number): Request {
    const offset = (page - 1) * 30;
    return GET(`${this.apiUrl}/Chapter?select=bookId,Book!inner(id,judul,cover)&Book.type=not.ilike.*novel*&order=created_at.desc&offset=${offset}&limit=30`, this.apiHeaders);
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    const chapters = response.parseAs<LatestChapterDto[]>();
    const hasNextPage = chapters.length === 30;

    const books = chapters.map((it) => it.Book).filter((it): it is BookDto => it != null);
    const mangaList = distinctBy(books, (it) => it.id).map((book) => {
      const manga = SManga.create();
      manga.url = String(book.id);
      manga.title = book.judul;
      manga.thumbnail_url = book.cover ?? undefined;
      return manga;
    });
    return new MangasPage(mangaList, hasNextPage);
  }

  // ========================= Search =========================
  // KeiSource.getSearchManga sends pasted URLs to getMangasByUrl; upstream resolves them in searchMangaRequest.
  protected override getMangasByUrl(url: URL, page: number): Promise<MangasPage> {
    return this.fetchSearchManga(page, url.href, this.getFilterList());
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    if (query.startsWith(PREFIX_ID_SEARCH)) {
      const id = query.slice(PREFIX_ID_SEARCH.length);
      return GET(`${this.apiUrl}/Book?select=id,judul,cover&type=not.ilike.*novel*&id=eq.${id}`, this.apiHeaders);
    } else if (query.startsWith("https://")) {
      const url = toHttpUrlOrNull(query);
      if (url != null && url.host === toHttpUrl(this.baseUrl).host) {
        const pathSegments = url.pathSegments;
        const typeIndex = pathSegments.findIndex((it) => it === "detail" || it === "view");
        if (typeIndex !== -1 && typeIndex + 1 < pathSegments.length) {
          const id = pathSegments[typeIndex + 1];
          return GET(`${this.apiUrl}/Book?select=id,judul,cover&type=not.ilike.*novel*&id=eq.${id}`, this.apiHeaders);
        }
      }
    }
    const offset = (page - 1) * 20;
    const url = toHttpUrl(`${this.apiUrl}/Book`).newBuilder();

    const selects = ["id", "judul", "cover"];
    let typeFilter = "not.ilike.*novel*";
    let sortColumn = "updated_at.desc";

    const selectedGenres: string[] = [];

    for (const filter of filters) {
      if (filter instanceof TypeFilter) {
        typeFilter = filter.state === 1 ? "eq.Manga" : filter.state === 2 ? "eq.Web Manga" : "not.ilike.*novel*";
      } else if (filter instanceof StatusFilter) {
        if (filter.state === 1) url.addQueryParameter("status", "eq.ongoing");
        else if (filter.state === 2) url.addQueryParameter("status", "ilike.*complete*");
        else if (filter.state === 3) url.addQueryParameter("status", "eq.oneshot");
      } else if (filter instanceof SortFilter) {
        const isAsc = filter.state?.ascending === true;
        const direction = isAsc ? "asc" : "desc";
        switch (filter.state?.index) {
          case 0:
            sortColumn = `updated_at.${direction}`;
            break;
          case 1:
            sortColumn = `created_at.${direction}`;
            break;
          case 2:
            sortColumn = `judul.${direction}`;
            break;
          default:
            sortColumn = "updated_at.desc";
        }
      } else if (filter instanceof HasChapterFilter) {
        if (filter.state) selects.push("Chapter!inner()");
      } else if (filter instanceof GenreFilter) {
        filter.state.filter((it) => it.state).forEach((it) => selectedGenres.push(it.id));
      }
    }

    if (selectedGenres.length) {
      selects.push("Genre!inner(id)");
      url.addQueryParameter("Genre.id", `in.(${selectedGenres.join(",")})`);
    }

    if (query) url.addQueryParameter("judul", `ilike.*${query}*`);

    url.addQueryParameter("select", selects.join(","));
    url.addQueryParameter("type", typeFilter);
    url.addQueryParameter("order", sortColumn);
    url.addQueryParameter("offset", String(offset));
    url.addQueryParameter("limit", "20");

    return GET(url.build(), this.apiHeaders);
  }

  protected searchMangaParse(response: Response): MangasPage {
    return this.popularMangaParse(response);
  }

  // ========================= Filters =========================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new HasChapterFilter(), new TypeFilter(), new StatusFilter(), new SortFilter(), new GenreFilter());
  }

  // ========================= Details =========================
  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/detail/${manga.url}`;
  }

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(`${this.apiUrl}/Book?select=*%2Cgenres%3A_BookGenre%28genre%3AGenre%28*%29%29&type=not.ilike.*novel*&id=eq.${manga.url}`, this.apiHeaders);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const books = response.parseAs<BookDto[]>();
    if (!books.length) throw new Error("Manga not found");
    const book = books[0];

    const manga = SManga.create();
    manga.title = book.judul;
    manga.thumbnail_url = book.cover ?? undefined;
    manga.author = book.author ?? undefined;
    manga.artist = book.artist ?? undefined;
    manga.description = book.synopsis ?? undefined;
    manga.status = this.parseStatus(book.status);
    manga.genre = book.genres
      ?.map((it) => it.genre?.nama)
      .filter((it) => it != null)
      .join(", ");
    return manga;
  }

  private parseStatus(status: string | null | undefined): number {
    switch (status?.toLowerCase()) {
      case "completed":
      case "complete":
      case "oneshot":
        return SManga.COMPLETED;
      case "ongoing":
        return SManga.ONGOING;
      default:
        return SManga.UNKNOWN;
    }
  }

  // ========================= Chapters =========================
  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/view/${chapter.url}`;
  }

  protected override chapterListRequest(manga: SManga): Request {
    return GET(`${this.apiUrl}/Chapter?select=id,bookId,chapter,nama,created_at&bookId=eq.${manga.url}&order=chapter.desc`, this.apiHeaders);
  }

  protected chapterListParse(response: Response): SChapter[] {
    const chapters = response.parseAs<ChapterDto[]>();
    return chapters.map((ch) => {
      const chapter = SChapter.create();
      chapter.url = `${ch.bookId}/${ch.id}`;
      let name = "";
      // Float.toString().removeSuffix(".0"): JS already prints whole numbers bare
      if (ch.chapter != null) name += `Chapter ${String(ch.chapter)}`;
      if (ch.nama != null && ch.nama.trim() !== "") {
        if (name) name += " - ";
        name += ch.nama;
      }
      chapter.name = name;
      chapter.chapter_number = ch.chapter ?? -1;
      chapter.date_upload = this.parseDate(ch.created_at);
      return chapter;
    });
  }

  private parseDate(dateStr: string | null | undefined): number {
    const t = this.dateFormat.tryParseDateTime(dateStr);
    return t !== 0 ? t : this.dateFormatNoMs.tryParseDateTime(dateStr);
  }

  // ========================= Pages =========================
  protected override pageListRequest(chapter: SChapter): Request {
    const id = substringAfterLast(chapter.url, "/");
    return GET(`${this.apiUrl}/Chapter?select=id,bookId,isigambar&id=eq.${id}`, this.apiHeaders);
  }

  protected pageListParse(response: Response): Page[] {
    const chapters = response.parseAs<ChapterDto[]>();
    if (!chapters.length) throw new Error("Chapter not found");
    const isigambar = chapters[0].isigambar;

    if (isigambar == null || isigambar.trim() === "") return [];

    let images: string[];
    try {
      images = parseAs<string[]>(isigambar);
    } catch {
      images = [];
    }

    return images.map((url, i) => new Page(i, "", url));
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }
}
