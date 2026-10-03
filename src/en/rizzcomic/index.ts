// Port of keiyoushi/extensions-source src/en/rizzcomic/RizzComic.kt
import { Filter, FilterList, MangasPage, SManga, type ClientBuilder, type PreferenceScreen, type Response, type SChapter, type SMangaUpdate } from "../../../sdk/index.ts";
import { MangaThemesiaAlt } from "../../../themes/mangathemesia/index.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter, genres, isFormBodyFilter } from "./filters.ts";

interface Comic {
  title: string;
  id: string;
  image_url?: string | null; // cover
  long_description?: string | null; // synopsis
  status?: string | null;
  type?: string | null;
  artist?: string | null;
  author?: string | null;
  serialization?: string | null;
  genre_id?: string | null; // genres
}

const comicSlugRegex = /[^a-z0-9]+/g;

function comicSlug(comic: Comic) {
  return comic.title
    .trim()
    .toLowerCase()
    .replaceAll("-", " ")
    .replaceAll("'s", "s")
    .replaceAll("'", "")
    .replace(comicSlugRegex, "-")
    .replaceAll("-ll-", "ll-")
    .replace(/^-+|-+$/g, "");
}

function comicGenreIds(comic: Comic) {
  return comic.genre_id?.split(",").map((it) => it.trim());
}

function capitalize(s: string) {
  const c = s.charAt(0);
  return c !== c.toUpperCase() ? c.toUpperCase() + s.slice(1) : s;
}

function randomString(length: number) {
  const charPool = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Array.from({ length }, () => charPool[Math.floor(Math.random() * charPool.length)]).join("");
}

export default class RizzComic extends MangaThemesiaAlt {
  override mangaUrlDirectory = "/series";
  override datePattern = "dd MMM yyyy";
  override pageSelector = "div#readerarea > img";

  protected override configureClient(builder: ClientBuilder) {
    return builder
      .addInterceptor((request) => {
        const isApiRequest = request.headers.get("X-API-Request") != null;
        const headers = new Headers(request.headers);
        if (!isApiRequest) headers.delete("X-Requested-With");
        headers.delete("X-API-Request");
        return { ...request, headers };
      })
      .rateLimit(1);
  }

  // For WebView
  protected override configureHeaders(headers: Headers) {
    headers.set("X-Requested-With", randomString(1 + Math.floor(Math.random() * 20)));
    return headers;
  }

  private get apiHeaders() {
    const h = this.headersBuilder();
    h.set("X-Requested-With", "XMLHttpRequest");
    h.set("X-API-Request", "1");
    return h;
  }

  protected override slugRegex = /^(r\d+-)/;

  // don't allow disabling random part setting
  override setupPreferenceScreen(_screen: PreferenceScreen) {}

  protected override get listUrl() {
    return this.mangaUrlDirectory;
  }
  protected override listSelector = "div.bsx a";

  override getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.POPULAR);
  }
  override getLatestUpdates(page: number) {
    return this.getSearchMangaList(page, "", SortFilter.LATEST);
  }

  override async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let res: Response;
    if (query) {
      const form = new URLSearchParams();
      form.append("search_value", query.trim());
      res = await this.client.post(`${this.baseUrl}/Index/live_search`, this.apiHeaders, form);
    } else {
      const form = new URLSearchParams();
      filters.filter(isFormBodyFilter).forEach((it) => it.addFormParameter(form));
      res = await this.client.post(`${this.baseUrl}/Index/filter_series`, this.apiHeaders, form);
    }
    return this.parseSearchManga(res);
  }

  override get supportsFilterFetching() {
    return false;
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Filters don't work with text search"), new SortFilter(), new StatusFilter(), new TypeFilter(), new GenreFilter());
  }

  private parseSearchManga(response: Response): MangasPage {
    const result = response.parseAs<Comic[]>();

    const entries = result.map((comic) => {
      const manga = SManga.create();
      manga.url = `${this.mangaUrlDirectory}/${comicSlug(comic)}/#${comic.id}`;
      manga.title = comic.title;
      manga.description = comic.long_description ?? undefined;
      manga.author = [comic.author, comic.serialization].filter((it) => it != null).join(", ");
      manga.artist = comic.artist ?? undefined;
      manga.status = this.parseStatus(comic.status);
      manga.thumbnail_url = comic.image_url != null ? `${this.baseUrl}/assets/images/${comic.image_url}` : undefined;
      const genre: (string | undefined)[] = [comic.type != null ? capitalize(comic.type) : undefined];
      comicGenreIds(comic)?.forEach((gId) => genre.push(genres.find((it) => it[1] === gId)?.[0]));
      manga.genre = genre.filter((it) => it != null).join(", ");
      manga.initialized = true;
      return manga;
    });

    return new MangasPage(entries, false);
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const update = await super.fetchMangaUpdate(manga, chapters, fetchDetails, fetchChapters);
    update.manga.description = manga.description;
    return update;
  }
}
