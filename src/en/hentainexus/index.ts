// Port of keiyoushi/extensions-source src/en/hentainexus/HentaiNexus.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  ListPreference,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ZoneOffset,
  firstInstanceOrNull,
  substringAfter,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import {
  ArtistFilter,
  AuthorFilter,
  CircleFilter,
  EventFilter,
  MagazineFilter,
  OffsetPageFilter,
  ParodyFilter,
  PublisherFilter,
  TagFilter,
  combineQuery,
} from "./filters.ts";
import { decryptData } from "./utils.ts";

const PREFIX_ID_SEARCH = "id:";
const POPULAR_NOW_PATH = "/explore/hot";
const PREF_IMAGE_FORMAT = "pref_image_format";

const IMAGE_FORMATS: Record<string, string> = {
  source: "Original",
  webp: "WebP",
  avif: "AVIF",
};

export default class HentaiNexus extends KeiSource {
  private get baseUrlHost() {
    return toHttpUrl(this.baseUrl).host;
  }

  // Images on this site go through the free Jetpack Photon CDN.
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(1, 1000, (url) => url.hostname === this.baseUrlHost);
  }

  private parseResponse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(".container .column").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
      manga.title = element.selectFirst(".card-header-title")!.text();
      manga.thumbnail_url = element.selectFirst(".card-image img")?.absUrl("src");
      return manga;
    });
    const isPopularNow = new URL(response.url).pathname === POPULAR_NOW_PATH;
    const hasNextPage = isPopularNow || document.selectFirst("a.pagination-next[href]") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private parseMangaResponse(response: Response): SMangaUpdate {
    const document = response.asJsoup();
    const table = document.selectFirst(".view-page-details")!;

    const manga = SManga.create();
    manga.title = document.selectFirst("h1.title")!.text();

    const artists = table.select("td.viewcolumn:contains(Artist) + td a").map((it) => it.ownText());
    const authors = table.select("td.viewcolumn:contains(Author) + td a").map((it) => it.ownText());
    manga.author = [...new Set([...authors, ...artists])].join(", ") || undefined;
    manga.artist = undefined;

    let description = "";
    for (const key of ["Circle", "Event", "Magazine", "Parody", "Publisher", "Pages", "Favorites"]) {
      const cell = table.selectFirst(`td.viewcolumn:contains(${key}) + td`);
      if (cell) {
        const own = cell.ownText();
        const value = own === "" ? cell.selectFirst("a")?.ownText() : own;
        if (value != null) description += `${key}: ${value}\n`;
      }
    }
    const desc = table.selectFirst("td.viewcolumn:contains(Description) + td")?.text();
    if (desc != null) description += `\n${desc}`;
    manga.description = description.trim();

    manga.genre =
      table
        .select("span.tag a")
        .map((it) => it.text().replace(this.tagCountRegex, ""))
        .join(", ") || undefined;

    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
    manga.status = SManga.COMPLETED;

    manga.thumbnail_url = document.selectFirst("figure.image img")?.attr("src");

    const dateUploadStr = table.selectFirst("td.viewcolumn:contains(Published) + td")?.text();

    const segments = new URL(response.url).pathname.slice(1).split("/");
    const id = segments[segments.length - 1];

    const chapter = SChapter.create();
    chapter.url = `/read/${id}`;
    chapter.name = "Chapter";
    chapter.date_upload = this.dateFormat.tryParseDate(dateUploadStr, ZoneOffset.UTC);

    return new SMangaUpdate(manga, [chapter]);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseResponse(await this.client.get(this.baseUrl + (page > 1 ? `/page/${page}` : "")));
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    if (page > 1) return this.getSearchMangaList(page - 1, "sort:popular", this.getFilterList());
    return this.parseResponse(await this.client.get(this.baseUrl + POPULAR_NOW_PATH));
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith(PREFIX_ID_SEARCH)) {
      const id = query.slice(PREFIX_ID_SEARCH.length);
      const manga = this.parseMangaResponse(await this.client.get(`${this.baseUrl}/view/${id}`)).manga;
      manga.url = `/view/${id}`;
      return new MangasPage([manga], false);
    }
    const b = toHttpUrl(this.baseUrl).newBuilder();
    const offset = firstInstanceOrNull(filters, OffsetPageFilter)?.state;
    const actualPage = page + (offset != null && /^[+-]?\d+$/.test(offset) ? Number.parseInt(offset, 10) : 0);
    if (actualPage > 1) b.addPathSegments(`page/${actualPage}`);
    b.addQueryParameter("q", (combineQuery(filters) + query).trim());
    return this.parseResponse(await this.client.get(b.build().toString()));
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const id = url.pathname.slice(1).split("/")[1];
    if (id === undefined) throw new Error("Unsupported url");
    const manga = this.parseMangaResponse(await this.client.get(`${this.baseUrl}/view/${id}`)).manga;
    manga.url = `/view/${id}`;
    return manga;
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    return this.parseMangaResponse(await this.client.get(`${this.baseUrl}${manga.url}`));
  }

  private readonly tagCountRegex = /\s*\([\d,]+\)$/;

  private readonly dateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.US);

  private imageFormatPref() {
    return this.preferences.getString(PREF_IMAGE_FORMAT, "webp")!;
  }

  private imageField(format: string) {
    switch (format) {
      case "source":
        return "image_source";
      case "avif":
        return "image_avif";
      default:
        return "image_fallback";
    }
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(`${this.baseUrl}${chapter.url}`)).asJsoup();

    const script = document.selectFirst("script:containsData(initReader)")?.data();
    if (script == null) throw new Error("Could not find initReader script; the page structure may have changed");

    const encoded = substringBefore(substringAfter(script, 'initReader("'), '",');
    const data = decryptData(encoded);

    const images = (JSON.parse(data) as Record<string, unknown>[]).filter((it) => it.type === "image");

    if (images.length === 0) return [];

    const format = this.imageFormatPref();
    const field = this.imageField(format);

    if (images[0][field] == null) {
      const label = IMAGE_FORMATS[format] ?? format;
      throw new Error(`Selected quality '${label}' is not available. Login or select another quality.`);
    }

    return images.map((page, i) => new Page(i, "", String(page[field])));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("Separate items with commas (,)\nPrepend with dash (-) to exclude\nFor items with multiple words, surround them with double quotes (\")"),
      new TagFilter(),
      new ArtistFilter(),
      new AuthorFilter(),
      new CircleFilter(),
      new EventFilter(),
      new ParodyFilter(),
      new MagazineFilter(),
      new PublisherFilter(),

      new Filter.Separator(),
      new OffsetPageFilter(),
    );
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new ListPreference(screen.context);
    p.key = PREF_IMAGE_FORMAT;
    p.title = "Image Quality";
    p.entries = Object.values(IMAGE_FORMATS);
    p.entryValues = Object.keys(IMAGE_FORMATS);
    p.summary = "%s\nOriginal quality requires a user account.";
    p.setDefaultValue("webp");
    screen.addPreference(p);
  }
}

