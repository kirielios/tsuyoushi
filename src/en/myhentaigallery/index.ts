// Port of keiyoushi/extensions-source src/en/myhentaigallery/MyHentaiGallery.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstanceOrNull,
  substringAfter,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Element,
} from "../../../sdk/index.ts";
import { ArtistFilter, GenreFilter, ParodyFilter, SortFilter, TagLookupFilter } from "./filters.ts";

const ARTIST_GENRE_PREFIX = "Artist: ";
const PARODY_GENRE_PREFIX = "Parody: ";
const TAG_URL_REGEX = /\/(artist|parody)\/(\d+)(?:[/?#]|$)/i;
const WHITESPACE_REGEX = /\s+/g;
const TAG_COUNT_SUFFIX = /\s*\(\d+\)\s*$/;

const encodeSpaces = (s: string): string => s.replaceAll(" ", "%20");
const normalizeTagName = (s: string): string => s.replace(TAG_COUNT_SUFFIX, "").trim().toLowerCase().replace(WHITESPACE_REGEX, " ");

export default class MyHentaiGallery extends KeiSource {
  // =============================== Popular ================================

  getPopularManga(page: number): Promise<MangasPage> {
    return this.parseComicListing(`${this.baseUrl}/views/${page}`);
  }

  // =============================== Latest =================================

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseComicListing(`${this.baseUrl}/gpage/${page}`);
  }

  // =============================== Search =================================

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.hostname !== new URL(this.baseUrl).hostname) return null;

    const pathSegments = url.pathname.slice(1).split("/").map(decodeURIComponent);
    let id: string | undefined;
    switch (pathSegments[0]) {
      case "gallery":
        id = pathSegments[2];
        break;
      case "g":
      case "a":
        id = pathSegments[1];
        break;
      default:
        id = undefined;
    }
    if (id === undefined || !/^\d*$/.test(id)) return null;

    const document = (await this.client.get(`${this.baseUrl}/g/${id}`)).asJsoup();
    const manga = SManga.create();
    manga.url = `/g/${id}`;
    return this.mangaDetailsParse(manga, document);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const genreUrl = await this.genreSearchUrl(query, page);
    if (genreUrl != null) return this.parseComicListing(genreUrl);

    if (query.trim()) {
      const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder().addPathSegment(String(page)).addQueryParameter("query", query).build();
      return this.parseComicListing(url.toString());
    }

    const categoryFilter = firstInstanceOrNull(filters, GenreFilter);
    const sortFilter = firstInstanceOrNull(filters, SortFilter);
    const tagLookupFilter = filters.filter((it): it is TagLookupFilter => it instanceof TagLookupFilter).find((it) => it.state.trim());

    if (tagLookupFilter != null) {
      const tagId = await this.resolveTagId(tagLookupFilter);
      return this.parseComicListing(`${this.baseUrl}/a/${tagLookupFilter.uriPart}/${tagId}/${page}`);
    }

    if (categoryFilter != null && categoryFilter.toUriPart().length > 0) {
      const catId = categoryFilter.toUriPart();
      return this.parseComicListing(`${this.baseUrl}/g/category/${catId}/${page}`);
    }

    const sortPath = sortFilter?.toUriPart() ?? "gpage";
    return this.parseComicListing(`${this.baseUrl}/${sortPath}/${page}`);
  }

  // ============================== Filters =================================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new Filter.Header("NOTE: Ignored if using text search!"),
      new Filter.Separator(),
      new SortFilter(),
      new Filter.Separator(),
      new GenreFilter(),
      new Filter.Separator(),
      new Filter.Header("Use one category/artist/parody filter at a time"),
      new Filter.Header("Artists/Parodies accept ID, tag URL, or exact name"),
      new ArtistFilter(),
      new ParodyFilter(),
    );
  }

  // =========================== Comic Listing ==============================

  private async parseComicListing(url: string): Promise<MangasPage> {
    const document = (await this.client.get(toHttpUrl(url).toString())).asJsoup();

    const mangas = document.select("div.comic-inner").map((element) => {
      const manga = SManga.create();
      manga.title = element.selectFirst("h2")!.text();
      manga.url = urlWithoutDomain(element.selectFirst("a")!.attr("href"));
      const src = element.selectFirst("img")?.absUrl("src");
      manga.thumbnail_url = src === undefined ? undefined : encodeSpaces(src);
      return manga;
    });

    const hasNextPage = document.selectFirst("li.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // =========================== Manga Details ==============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.url = substringAfter(document.location(), this.baseUrl);

    return new SMangaUpdate(this.mangaDetailsParse(manga, document), [chapter]);
  }

  private mangaDetailsParse(manga: SManga, document: Document): SManga {
    const info: Element = document.selectFirst("div.comic-header")!;
    const categories = info.select("div:containsOwn(categories) a").eachText();
    const artists = info.select("div:containsOwn(artists) a").eachText();
    const parodies = info.select("div:containsOwn(parodies) a").eachText();

    manga.title = info.selectFirst("h1")!.text();
    manga.genre = [...categories, ...artists.map((it) => `${ARTIST_GENRE_PREFIX}${it}`), ...parodies.map((it) => `${PARODY_GENRE_PREFIX}${it}`)].join(", ");
    manga.artist = artists.join(", ");
    const src = document.selectFirst(".comic-listing .comic-inner img")?.absUrl("src");
    manga.thumbnail_url = src === undefined ? undefined : encodeSpaces(src);
    manga.status = SManga.COMPLETED;

    let description = "";
    const groups = info.select("div:containsOwn(groups) a");
    if (groups.length > 0) {
      if (description.length > 0) description += "\n\n";
      description += "Groups:\n";
      description += groups.map((it) => `- ${it.text()}`).join("\n");
    }
    const parodyLinks = info.select("div:containsOwn(parodies) a");
    if (parodyLinks.length > 0) {
      if (description.length > 0) description += "\n\n";
      description += "Parodies:\n";
      description += parodyLinks.map((it) => `- ${it.text()}`).join("\n");
    }
    manga.description = description;
    return manga;
  }

  // ============================== Page List ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.getChapterUrl(chapter)))
      .asJsoup()
      .select("div.comic-thumb img[src]")
      .map((img, i) => new Page(i, "", encodeSpaces(img.absUrl("src").replace("/thumbnail/", "/original/"))));
  }

  // ============================== Helpers =================================

  // Routes a clicked artist/parody genre chip to its tag listing instead of a title search.
  private async genreSearchUrl(query: string, page: number): Promise<string | null> {
    let uriPart: string;
    let name: string;
    if (query.startsWith(ARTIST_GENRE_PREFIX)) [uriPart, name] = ["artist", query.slice(ARTIST_GENRE_PREFIX.length)];
    else if (query.startsWith(PARODY_GENRE_PREFIX)) [uriPart, name] = ["parody", query.slice(PARODY_GENRE_PREFIX.length)];
    else return null;
    const id = await this.lookupTagId(uriPart, name);
    if (id == null) throw new Error(`No ${uriPart} "${name}" was found.`);
    return `${this.baseUrl}/a/${uriPart}/${id}/${page}`;
  }

  private async resolveTagId(filter: TagLookupFilter): Promise<string> {
    const value = filter.state.trim();
    if (/^[+-]?\d+$/.test(value)) return BigInt(value).toString();

    const match = TAG_URL_REGEX.exec(value);
    if (match) {
      const namespace = match[1].toLowerCase();
      if (namespace !== filter.uriPart) throw new Error(`Expected a ${filter.uriPart} URL, got a ${namespace} URL`);

      return match[2];
    }

    const id = await this.lookupTagId(filter.uriPart, value);
    if (id == null) throw new Error(`No ${filter.uriPart} "${value}" was found. Use the exact tag name, numeric ID, or full MyHentaiGallery tag URL.`);
    return id;
  }

  private async lookupTagId(uriPart: string, name: string): Promise<string | null> {
    let lookup = this.tagLookupCache.get(uriPart);
    if (!lookup) {
      lookup = await this.loadTagLookup(uriPart);
      this.tagLookupCache.set(uriPart, lookup);
    }
    return lookup.get(normalizeTagName(name)) ?? null;
  }

  private async loadTagLookup(uriPart: string): Promise<Map<string, string>> {
    const tagUrlRegex = new RegExp(`/${uriPart}/(\\d+)(?:[/?#]|$)`, "i");

    const map = new Map<string, string>();
    (await this.client.get(`${this.baseUrl}/tag/${uriPart}`))
      .asJsoup()
      .select(`a[href*='/${uriPart}/']`)
      .forEach((element) => {
        const id = tagUrlRegex.exec(element.attr("href"))?.[1];
        if (id === undefined) return;
        const name = normalizeTagName(element.text());
        if (name.trim()) map.set(name, id);
      });
    return map;
  }

  private readonly tagLookupCache = new Map<string, Map<string, string>>();
}
