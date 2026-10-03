// Port of keiyoushi/extensions-source src/all/webcomics/Webcomics.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstance,
  isNotBlank,
  substringAfterLast,
  toHttpUrl,
  type ClientBuilder,
  type Response,
} from "../../../sdk/index.ts";

// --- WebcomicsDto.kt
interface DataWrapper<T> {
  data: T;
}
interface BookDto {
  name: string;
  cover: string;
  category: string[];
  author: string;
  description: string;
  status: string;
}
interface ChapterListDto {
  list: ChapterDto[];
}
interface ChapterDto {
  chapter_id: string;
  index: number;
  is_pay: boolean;
  name: string;
  update_time: number;
}
interface ImageListDto {
  base_url: string;
  images: { url: string }[];
}
interface UserAgentList {
  desktop: string[];
}

const UA_DB_URL = "https://keiyoushi.github.io/user-agents/user-agents.json";
const WHITE_SPACE_REGEX = /[\s]+/g;
const PUNCTUATION_REGEX = /[!-/:-@[-`{-~]/g; // \p{Punct}

const toPathSegment = (s: string) => s.replace(PUNCTUATION_REGEX, "").replace(WHITE_SPACE_REGEX, "-").toLowerCase();

class SelectFilter extends Filter.Select<string> {
  constructor(name: string, readonly items: string[]) {
    super(name, items);
  }
  selected() {
    return toPathSegment(this.items[this.state]);
  }
}
class GenreFilter extends SelectFilter {}
class StatusFilter extends SelectFilter {}
class SortFilter extends SelectFilter {}

export default class Webcomics extends KeiSource {
  private readonly apiSubDomain = "official-website-api";
  private get apiUrl() {
    return `https://${this.apiSubDomain}.${substringAfterLast(this.baseUrl, "/")}/api/web/v4/book`;
  }

  protected override configureHeaders(headers: Headers) {
    headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    return headers;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder
      .addInterceptor(async (request) => {
        const ua = await this.getDesktopUA();
        const headers = new Headers(request.headers);
        headers.set("User-Agent", ua.desktop[Math.floor(Math.random() * ua.desktop.length)]);
        return { ...request, headers };
      })
      .rateLimit(3);
  }

  private userAgentList: UserAgentList | null = null;

  private async getDesktopUA(): Promise<UserAgentList> {
    // the UA list request goes through the same client, whose interceptor would recurse; send it plain like upstream's network.client
    return (this.userAgentList ??= (await this.host.fetch(UA_DB_URL, { method: "GET", headers: {} }).then((r) => JSON.parse(new TextDecoder().decode(r.body)))) as UserAgentList);
  }

  private jsonHeaders() {
    const h = this.headers;
    h.set("Content-Type", "application/json; charset=utf-8");
    return h;
  }

  private listUrl(...segments: string[]) {
    const b = toHttpUrl(this.baseUrl).newBuilder();
    b.addPathSegment(this.lang);
    segments.forEach((s) => b.addPathSegment(s));
    return b.build();
  }

  // ========================== Popular =====================================

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = this.listUrl(toPathSegment(this.genreTitle), toPathSegment(this.genres[0]), toPathSegment(this.statuses[0]), toPathSegment(this.sorts[0]), String(page));
    return this.parseMangasPage(await this.client.get(url.toString()));
  }

  private parseMangasPage(response: Response): MangasPage {
    const document = response.asJsoup();
    const nuxtData = document.selectFirst("script#__NUXT_DATA__")?.data();

    const mangaList = document.select(".grid > a").map((element) => {
      const url = element.attr("abs:href");
      let thumbnail: string | undefined = element.selectFirst("img[src]")?.attr("abs:src");
      if (!thumbnail?.startsWith("http")) {
        const regex = new RegExp(`"${substringAfterLast(url, "/")}"[^"]*"[^"]*"[^"]*"(https[^"]+)"`);
        thumbnail = nuxtData ? regex.exec(nuxtData)?.[1] : undefined;
      }

      const segments = toHttpUrl(url).pathSegments;
      const manga = SManga.create();
      manga.title = element.selectFirst("p.text-ink,span[class*=text]")!.text();
      manga.thumbnail_url = thumbnail;
      manga.url = segments[3];
      manga.memo = { slug: segments[1], name: segments[2] };
      return manga;
    });

    const hasNextPage = document.selectFirst("div > span.cursor-default.bg-primary + a") != null;
    return new MangasPage(mangaList, hasNextPage);
  }

  // ========================== Latest =====================================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.listUrl(toPathSegment(this.genreTitle), toPathSegment(this.genres[0]), toPathSegment(this.statuses[0]), toPathSegment(this.sorts[this.sorts.length - 1]), String(page));
    return this.parseMangasPage(await this.client.get(url.toString()));
  }

  // ========================== Search =====================================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (isNotBlank(query)) {
      const url = toHttpUrl(`${this.baseUrl}/${this.lang}/search`).newBuilder().addQueryParameter("q", query).build();
      return this.parseMangasPage(await this.client.get(url.toString()));
    }
    const genre = firstInstance(filters, GenreFilter).selected();
    const status = firstInstance(filters, StatusFilter).selected();
    const sort = firstInstance(filters, SortFilter).selected();
    const url = this.listUrl(toPathSegment(this.genreTitle), genre, status, sort, String(page));
    return this.parseMangasPage(await this.client.get(url.toString()));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const segments = url.pathname.slice(1).split("/");
    if (url.hostname !== toHttpUrl(this.baseUrl).host || segments[0] !== this.lang || segments.length < 4) return null;

    const mangaUrl = `/${this.lang}/${segments[1]}/${segments[2]}/${segments[3]}`;
    const manga = SManga.create();
    manga.url = mangaUrl;

    const result = (await this.fetchMangaUpdate(manga, [], true, false)).manga;
    result.initialized = true;
    result.url = mangaUrl;
    return result;
  }

  // ========================== Updates ====================================

  override getMangaUrl(manga: SManga): string {
    return this.listUrl(manga.memo.slug as string, manga.memo.name as string, manga.url).toString();
  }

  override getChapterUrl(chapter: SChapter): string {
    return this.listUrl(chapter.memo.slug as string, chapter.memo.name as string, String(chapter.memo.index as number), chapter.memo.mangaId as string).toString();
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [m, c] = await Promise.all([fetchDetails ? this.getMangaDetails(manga) : manga, fetchChapters ? this.getChapterList(manga) : chapters]);
    return new SMangaUpdate(m, c);
  }

  private async getMangaDetails(manga: SManga): Promise<SManga> {
    const body = JSON.stringify({ book_id: manga.url });
    const dto = (await this.client.post(`${this.apiUrl}/info`, this.jsonHeaders(), body)).parseAs<DataWrapper<BookDto>>().data;
    const result = SManga.create();
    result.title = dto.name;
    result.thumbnail_url = dto.cover;
    result.description = dto.description;
    result.author = dto.author;
    result.genre = dto.category.join(", ");
    result.status = dto.status === this.statuses[1] ? SManga.ONGOING : SManga.COMPLETED;
    result.memo = manga.memo;
    return result;
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const mangaId = manga.url;
    const body = JSON.stringify({ book_id: mangaId, page: 1, size: 9999, sort: "desc" });
    const dto = (await this.client.post(`${this.apiUrl}/chapter/list`, this.jsonHeaders(), body)).parseAs<DataWrapper<ChapterListDto>>().data;
    return dto.list.map((chapter) => {
      const c = SChapter.create();
      c.name = chapter.is_pay ? `🔒 ${chapter.name}` : chapter.name;
      c.date_upload = chapter.update_time;
      c.chapter_number = chapter.index;
      c.url = chapter.chapter_id;
      c.memo = { index: chapter.index, mangaId, slug: manga.memo.slug, name: manga.memo.name };
      return c;
    });
  }

  // ========================== Pages ====================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const body = JSON.stringify({ book_id: chapter.memo.mangaId, chapter_id: chapter.url, index: chapter.memo.index });
    const dto = (await this.client.post(`${this.apiUrl}/chapter/detail`, this.jsonHeaders(), body)).parseAs<DataWrapper<ImageListDto>>().data;
    return dto.images.map((img, index) => new Page(index, "", dto.base_url + img.url));
  }

  // ========================== Filters ==================================

  private get genreTitle() {
    return { en: "Genres", fr: "Genres", pt: "Gêneros", es: "Géneros", id: "Genre" }[this.lang] ?? this.invalidLang();
  }
  private get genres(): string[] {
    switch (this.lang) {
      case "en":
        return ["All", "Romance", "Action", "Fantasy", "BL", "Eastern Fantasy", "Eastern Romance", "Drama", "GL", "LGBTQ+", "Slice of Life", "Comedy", "Horror", "Mystery", "Sci-Fi"];
      case "fr":
        return ["Tous", "Amour", "Action", "Fantaisie", "BL", "Fantaisie orientale", "Amour orientale", "Drame", "Comédie", "Science-fiction"];
      case "pt":
        return ["Todos", "Romance", "Ação", "Fantasia", "BL", "Fantasia Oriental Antiga", "Romance Oriental Antigo", "Drama", "Humor", "Ficção"];
      case "es":
        return ["Todos", "Romance", "Acción", "Fantasía", "BL", "Fantasía Oriental", "Romance Oriental", "Drama", "Comedia", "Ciencia Ficción"];
      case "id":
        return ["Semua", "Romantis", "Aksi", "Fantasi", "Boys' Love", "Fantasi Asia", "Romantis Asia", "Drama", "Komedi", "Sci-Fi"];
      default:
        return this.invalidLang();
    }
  }
  private get statusTitle() {
    return { en: "Filter By", fr: "Filtrer par", pt: "Filtrar por", es: "Filtrar por", id: "Filter" }[this.lang] ?? this.invalidLang();
  }
  private get statuses(): string[] {
    return (
      {
        en: ["All", "Ongoing", "Completed"],
        fr: ["Tous", "Sérialisé", "Terminé"],
        pt: ["Todos", "Em série", "Concluído"],
        es: ["Todos", "En curso", "Terminado"],
        id: ["Semua", "Berlangsung", "Tamat"],
      } as Record<string, string[]>
    )[this.lang] ?? this.invalidLang();
  }
  private get sortTitle() {
    return { en: "Sort By", fr: "Trier par", pt: "Ordenar por", es: "Ordenar por", id: "Urutkan" }[this.lang] ?? this.invalidLang();
  }
  private get sorts(): string[] {
    return (
      {
        en: ["Hottest", "Best-rated", "Newest"],
        fr: ["Top", "Mieux notés", "Nouveautés"],
        pt: ["Mais populares", "Mais avaliados", "Mais recentes"],
        es: ["Populares", "Mejor calificados", "Más nuevos"],
        id: ["Terpopuler", "Rating Tertinggi", "Terbaru"],
      } as Record<string, string[]>
    )[this.lang] ?? this.invalidLang();
  }
  private invalidLang(): never {
    throw new Error(`Invalid lang: ${this.lang}`);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("Filtering is ignored when searching by text."),
      new Filter.Separator(),
      new GenreFilter(this.genreTitle, this.genres),
      new StatusFilter(this.statusTitle, this.statuses),
      new SortFilter(this.sortTitle, this.sorts),
    );
  }
}
