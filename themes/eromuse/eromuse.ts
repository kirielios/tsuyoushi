// Port of keiyoushi/extensions-source lib-multisrc/eromuse/EroMuse.kt
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, isNotBlank, substringBefore, toHttpUrl, urlWithoutDomain, type Document, type Element } from "../../sdk/index.ts";

export const VARIOUS_AUTHORS = 0;
export const AUTHOR = 1;
export const SEARCH_RESULTS_OR_BASE = 2;

/** Album name, path segments, page type */
export type Album = [string, string, number];

// the stack - shouldn't need to touch these except for visibility
export interface StackItem {
  url: string;
  pageType: number;
}

export class AlbumFilter extends Filter.Select<string> {
  constructor(private readonly vals: Album[]) {
    super(
      "Album",
      vals.map((it) => it[0]),
    );
  }
  selection() {
    return { pathSegments: this.vals[this.state][1], pageType: this.vals[this.state][2] };
  }
}

export class SortFilter extends Filter.Select<string> {
  constructor(private readonly vals: [string, string][]) {
    super(
      "Sort Order",
      vals.map((it) => it[0]),
    );
  }
  toQueryValue() {
    return this.vals[this.state][1];
  }
}

function firstInstance<T>(filters: FilterList, cls: abstract new (...args: never[]) => T): T {
  const it = filters.find((f) => f instanceof cls);
  if (!it) throw new Error("No element of the required type was found in the filter list.");
  return it as T;
}

const pageQueryRegex = /page=\d+/;

export abstract class EroMuse extends KeiSource {
  /**
   * Browse, search, and latest all run through an ArrayDeque of requests that acts as a stack we push and pop to/from
   * For the fetch functions, we only need to worry about pushing the first page to the stack because subsequent pages
   * get pushed to the stack during parseManga(). Page 1's URL must include page=1 if the next page would be page=2,
   * if page 2 is path_to/2, nothing special needs to be done.
   */
  private stackItem!: StackItem;
  protected readonly pageStack: StackItem[] = [];
  protected currentSortingMode!: string;

  private readonly albums = this.getAlbumList();

  // might need to override for new sources
  private readonly nextPageSelector = ".pagination span.current + span a";
  protected albumSelector = "a.c-tile:has(img):not(:has(.members-only))";
  protected topLevelPathSegment = "comics/album";

  private nextPageOrNull(document: Document): string | null {
    const url = document.location();
    const text = document.select(this.nextPageSelector)[0]?.text();
    if (text == null || !/^[+-]?\d+$/.test(text)) return null;
    const int = Number(text);
    if (pageQueryRegex.test(url)) return url.replace(pageQueryRegex, `page=${int}`);
    const httpUrl = toHttpUrl(url);
    const last = httpUrl.pathSegments.at(-1)!;
    const builder = /^[+-]?\d+$/.test(last) ? httpUrl.newBuilder().removePathSegment(httpUrl.pathSegments.length - 1) : httpUrl.newBuilder();
    return builder.addPathSegment(String(int)).toString();
  }

  private addNextPageToStack(document: Document) {
    const next = this.nextPageOrNull(document);
    if (next != null) this.pageStack.push({ url: next, pageType: this.stackItem.pageType });
  }

  protected imgAttr(element: Element): string {
    return element.hasAttr("data-src") ? element.attr("abs:data-src") : element.attr("abs:src");
  }

  private mangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.attr("href"));
    manga.title = element.text();
    const img = element.select("img")[0];
    manga.thumbnail_url = img ? this.imgAttr(img) : undefined;
    return manga;
  }

  protected getAlbumType(url: string, def = AUTHOR): number {
    const lower = url.toLowerCase();
    return this.albums.filter((it) => it[2] !== SEARCH_RESULTS_OR_BASE && lower.includes(it[1].toLowerCase()))[0]?.[2] ?? def;
  }

  private pushAuthors(document: Document) {
    for (const it of document.select(this.albumSelector).reverse()) this.pageStack.push({ url: it.attr("abs:href"), pageType: AUTHOR });
  }

  protected async parseManga(document: Document): Promise<MangasPage> {
    const internalParse = async (internalDocument: Document): Promise<SManga[]> => {
      let authorDocument: Document;
      if (this.stackItem.pageType === VARIOUS_AUTHORS) {
        this.pushAuthors(internalDocument);
        authorDocument = (await this.client.get(this.stackUrl())).asJsoup();
      } else {
        authorDocument = internalDocument;
      }
      this.addNextPageToStack(authorDocument);
      return authorDocument.select(this.albumSelector).map((it) => this.mangaFromElement(it));
    };

    if ([VARIOUS_AUTHORS, SEARCH_RESULTS_OR_BASE].includes(this.stackItem.pageType)) this.addNextPageToStack(document);
    let mangas: SManga[];
    switch (this.stackItem.pageType) {
      case VARIOUS_AUTHORS:
        this.pushAuthors(document);
        mangas = await internalParse(document);
        break;

      case AUTHOR:
        mangas = await internalParse(document);
        break;

      case SEARCH_RESULTS_OR_BASE: {
        const searchMangas: SManga[] = [];
        for (const element of document.select(this.albumSelector)) {
          const url = element.attr("abs:href");
          const prefix = `${this.baseUrl}/${this.topLevelPathSegment}/`;
          const depth = (url.startsWith(prefix) ? url.slice(prefix.length) : url).split("/").length;

          switch (this.getAlbumType(url)) {
            case VARIOUS_AUTHORS:
              if (depth === 1) {
                // eg. /comics/album/Fakku-Comics
                this.pageStack.push({ url, pageType: VARIOUS_AUTHORS });
                if (!searchMangas.length) searchMangas.push(...(await internalParse((await this.client.get(this.stackUrl())).asJsoup())));
              } else if (depth === 2) {
                // eg. /comics/album/Fakku-Comics/Bosshi
                this.pageStack.push({ url, pageType: AUTHOR });
                if (!searchMangas.length) searchMangas.push(...(await internalParse((await this.client.get(this.stackUrl())).asJsoup())));
              } else {
                // eg. 3 -> /comics/album/Fakku-Comics/Bosshi/After-Summer-After
                // eg. 5 -> /comics/album/Various-Authors/Firollian/Reward/Reward-22/ElfAlfie
                // eg. 6 -> /comics/album/Various-Authors/Firollian/Area69/Area69-no_1/SamusAran/001_Dialogue
                searchMangas.push(this.mangaFromElement(element));
              }
              break;

            case AUTHOR:
              if (depth === 1) {
                // eg. /comics/album/ShadBase-Comics
                this.pageStack.push({ url, pageType: AUTHOR });
                if (!searchMangas.length) searchMangas.push(...(await internalParse((await this.client.get(this.stackUrl())).asJsoup())));
              } else {
                // eg. 2 -> /comics/album/ShadBase-Comics/RickMorty
                // eg. 3 -> /comics/album/Incase-Comics/Comic/Alfie
                searchMangas.push(this.mangaFromElement(element));
              }
              break;
            // SEARCH_RESULTS_OR_BASE shouldn't be a case
          }
        }
        mangas = searchMangas;
        break;
      }

      default:
        mangas = [];
    }
    return new MangasPage(mangas, this.pageStack.length > 0);
  }

  protected stackUrl(): string {
    const item = this.pageStack.pop();
    if (!item) throw new Error("ArrayDeque is empty.");
    this.stackItem = item;
    if (this.stackItem.pageType === AUTHOR && this.currentSortingMode && !this.stackItem.url.includes("sort")) {
      return toHttpUrl(this.stackItem.url).newBuilder().addQueryParameter("sort", this.currentSortingMode).toString();
    }
    return this.stackItem.url;
  }

  // Popular

  protected async fetchManga(url: string, page: number, sortingMode: string): Promise<MangasPage> {
    if (page === 1) {
      this.pageStack.length = 0;
      this.pageStack.push({ url, pageType: VARIOUS_AUTHORS });
      this.currentSortingMode = sortingMode;
    }

    return this.parseManga((await this.client.get(this.stackUrl())).asJsoup());
  }

  override getPopularManga(page: number): Promise<MangasPage> {
    return this.fetchManga(`${this.baseUrl}/comics/album/Various-Authors`, page, "");
  }

  // Latest

  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.fetchManga(`${this.baseUrl}/comics/album/Various-Authors?sort=date`, page, "date");
  }

  // Search

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (page === 1) {
      this.pageStack.length = 0;

      this.currentSortingMode = firstInstance(filters, SortFilter).toQueryValue();

      if (isNotBlank(query)) {
        const url = toHttpUrl(`${this.baseUrl}/search?q=${query}`).newBuilder();
        if (this.currentSortingMode) url.addQueryParameter("sort", this.currentSortingMode);
        url.addQueryParameter("page", "1");
        this.pageStack.push({ url: url.toString(), pageType: SEARCH_RESULTS_OR_BASE });
      } else {
        const albumFilter = firstInstance(filters, AlbumFilter).selection();
        const url = toHttpUrl(`${this.baseUrl}/comics/${albumFilter.pathSegments}`).newBuilder();
        if (this.currentSortingMode) url.addQueryParameter("sort", this.currentSortingMode);
        if (albumFilter.pageType !== AUTHOR) url.addQueryParameter("page", "1");
        this.pageStack.push({ url: url.toString(), pageType: albumFilter.pageType });
      }
    }

    return this.parseManga((await this.client.get(this.stackUrl())).asJsoup());
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;

    const document = (await this.client.get(url)).asJsoup();
    const manga = this.parseDetails(document);
    manga.title = substringBefore(document.selectFirst("title")?.text() ?? "", " | ");
    return manga;
  }

  // Details

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    // Details and chapters come from the same page
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const details = this.parseDetails(document);
    details.title = manga.title;
    return new SMangaUpdate(details, fetchChapters ? await this.parseChapters(document) : chapters);
  }

  protected parseDetails(document: Document): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(document.location());
    const img = document.select(`${this.albumSelector} img`)[0];
    manga.thumbnail_url = img ? this.imgAttr(img) : undefined;
    switch (this.getAlbumType(manga.url)) {
      case AUTHOR:
        // eg. https://comics.8muses.com/comics/album/ShadBase-Comics/RickMorty
        // eg. https://comics.8muses.com/comics/album/Incase-Comics/Comic/Alfie
        manga.author = document.select("div.top-menu-breadcrumb li:nth-child(2)").text();
        break;
      case VARIOUS_AUTHORS:
        // eg. https://comics.8muses.com/comics/album/Various-Authors/NLT-Media/A-Sunday-Schooling
        manga.author = document.select("div.top-menu-breadcrumb li:nth-child(3)").text();
        break;
    }
    return manga;
  }

  // Chapters

  protected linkedChapterSelector = "a.c-tile:has(img)[href*=/comics/album/]";
  protected pageThumbnailSelector = "a.c-tile:has(img)[href*=/comics/picture/] img";

  private async parseChapters(firstPage: Document): Promise<SChapter[]> {
    const parseChapters = async (document: Document, isFirstPage: boolean, chapters: SChapter[]): Promise<SChapter[]> => {
      // Linked chapters
      for (const it of document.select(this.linkedChapterSelector)) {
        const chapter = SChapter.create();
        chapter.name = it.text();
        chapter.url = urlWithoutDomain(it.attr("href"));
        chapters.unshift(chapter);
      }

      if (isFirstPage) {
        // Self
        if (document.select(this.pageThumbnailSelector)[0]) {
          const chapter = SChapter.create();
          chapter.name = "Chapter";
          chapter.url = urlWithoutDomain(document.location());
          chapters.push(chapter);
        }
      }

      const url = this.nextPageOrNull(document);
      if (url != null) await parseChapters((await this.client.get(url)).asJsoup(), false, chapters);
      return chapters;
    };

    return parseChapters(firstPage, true, []);
  }

  // Pages

  protected pageThumbnailPathSegment = "/th/";
  protected pageFullSizePathSegment = "/fl/";

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const parsePages = async (document: Document, nestedChapterDocuments: Document[] = [], pages: Page[] = []): Promise<Page[]> => {
      // Nested chapters aka folders
      for (const it of document.select(this.linkedChapterSelector)) {
        nestedChapterDocuments.push((await this.client.get(it.attr("abs:href"))).asJsoup());
      }

      const lastPage = pages.length;
      pages.push(...document.select(this.pageThumbnailSelector).map((img, i) => new Page(lastPage + i, "", this.imgAttr(img).replaceAll(this.pageThumbnailPathSegment, this.pageFullSizePathSegment))));

      const url = this.nextPageOrNull(document);
      if (url != null) {
        // upstream: pages.addAll(parsePages(..., pages)) - the recursion returns this same list, so it is appended to itself
        pages.push(...(await parsePages((await this.client.get(url)).asJsoup(), nestedChapterDocuments, pages)));
      }

      while (nestedChapterDocuments.length) {
        pages.push(...(await parsePages(nestedChapterDocuments.shift()!)));
      }

      return pages;
    };

    return parsePages((await this.client.get(this.getChapterUrl(chapter))).asJsoup());
  }

  // Filters

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Text search only combines with sort!"), new Filter.Separator(), new AlbumFilter(this.getAlbumList()), new SortFilter(this.getSortList()));
  }

  protected getAlbumList(): Album[] {
    return [
      ["All Authors", "", SEARCH_RESULTS_OR_BASE],
      ["Various Authors", "album/Various-Authors", VARIOUS_AUTHORS],
      ["Fakku Comics", "album/Fakku-Comics", VARIOUS_AUTHORS],
      ["Hentai and Manga English", "album/Hentai-and-Manga-English", VARIOUS_AUTHORS],
      ["Fake Celebrities Sex Pictures", "album/Fake-Celebrities-Sex-Pictures", AUTHOR],
      ["MilfToon Comics", "album/MilfToon-Comics", AUTHOR],
      ["BE Story Club Comics", "album/BE-Story-Club-Comics", AUTHOR],
      ["ShadBase Comics", "album/ShadBase-Comics", AUTHOR],
      ["ZZZ Comics", "album/ZZZ-Comics", AUTHOR],
      ["PalComix Comics", "album/PalComix-Comics", AUTHOR],
      ["MCC Comics", "album/MCC-Comics", AUTHOR],
      ["Expansionfan Comics", "album/Expansionfan-Comics", AUTHOR],
      ["JAB Comics", "album/JAB-Comics", AUTHOR],
      ["Giantess Fan Comics", "album/Giantess-Fan-Comics", AUTHOR],
      ["Renderotica Comics", "album/Renderotica-Comics", AUTHOR],
      ["IllustratedInterracial.com Comics", "album/IllustratedInterracial_com-Comics", AUTHOR],
      ["Giantess Club Comics", "album/Giantess-Club-Comics", AUTHOR],
      ["Innocent Dickgirls Comics", "album/Innocent-Dickgirls-Comics", AUTHOR],
      ["Locofuria Comics", "album/Locofuria-Comics", AUTHOR],
      ["PigKing - CrazyDad Comics", "album/PigKing-CrazyDad-Comics", AUTHOR],
      ["Cartoon Reality Comics", "album/Cartoon-Reality-Comics", AUTHOR],
      ["Affect3D Comics", "album/Affect3D-Comics", AUTHOR],
      ["TG Comics", "album/TG-Comics", AUTHOR],
      ["Melkormancin.com Comics", "album/Melkormancin_com-Comics", AUTHOR],
      ["Seiren.com.br Comics", "album/Seiren_com_br-Comics", AUTHOR],
      ["Tracy Scops Comics", "album/Tracy-Scops-Comics", AUTHOR],
      ["Fred Perry Comics", "album/Fred-Perry-Comics", AUTHOR],
      ["Witchking00 Comics", "album/Witchking00-Comics", AUTHOR],
      ["8muses Comics", "album/8muses-Comics", AUTHOR],
      ["KAOS Comics", "album/KAOS-Comics", AUTHOR],
      ["Vaesark Comics", "album/Vaesark-Comics", AUTHOR],
      ["Fansadox Comics", "album/Fansadox-Comics", AUTHOR],
      ["DreamTales Comics", "album/DreamTales-Comics", AUTHOR],
      ["Croc Comics", "album/Croc-Comics", AUTHOR],
      ["Jay Marvel Comics", "album/Jay-Marvel-Comics", AUTHOR],
      ["JohnPersons.com Comics", "album/JohnPersons_com-Comics", AUTHOR],
      ["MuscleFan Comics", "album/MuscleFan-Comics", AUTHOR],
      ["Taboolicious.xxx Comics", "album/Taboolicious_xxx-Comics", AUTHOR],
      ["MongoBongo Comics", "album/MongoBongo-Comics", AUTHOR],
      ["Slipshine Comics", "album/Slipshine-Comics", AUTHOR],
      ["Everfire Comics", "album/Everfire-Comics", AUTHOR],
      ["PrismGirls Comics", "album/PrismGirls-Comics", AUTHOR],
      ["Abimboleb Comics", "album/Abimboleb-Comics", AUTHOR],
      ["Y3DF - Your3DFantasy.com Comics", "album/Y3DF-Your3DFantasy_com-Comics", AUTHOR],
      ["Grow Comics", "album/Grow-Comics", AUTHOR],
      ["OkayOkayOKOk Comics", "album/OkayOkayOKOk-Comics", AUTHOR],
      ["Tufos Comics", "album/Tufos-Comics", AUTHOR],
      ["Cartoon Valley", "album/Cartoon-Valley", AUTHOR],
      ["3DMonsterStories.com Comics", "album/3DMonsterStories_com-Comics", AUTHOR],
      ["Kogeikun Comics", "album/Kogeikun-Comics", AUTHOR],
      ["The Foxxx Comics", "album/The-Foxxx-Comics", AUTHOR],
      ["Theme Collections", "album/Theme-Collections", AUTHOR],
      ["Interracial-Comics", "album/Interracial-Comics", AUTHOR],
      ["Expansion Comics", "album/Expansion-Comics", AUTHOR],
      ["Moiarte Comics", "album/Moiarte-Comics", AUTHOR],
      ["Incognitymous Comics", "album/Incognitymous-Comics", AUTHOR],
      ["DizzyDills Comics", "album/DizzyDills-Comics", AUTHOR],
      ["DukesHardcoreHoneys.com Comics", "album/DukesHardcoreHoneys_com-Comics", AUTHOR],
      ["Stormfeder Comics", "album/Stormfeder-Comics", AUTHOR],
      ["Bimbo Story Club Comics", "album/Bimbo-Story-Club-Comics", AUTHOR],
      ["Smudge Comics", "album/Smudge-Comics", AUTHOR],
      ["Dollproject Comics", "album/Dollproject-Comics", AUTHOR],
      ["SuperHeroineComixxx", "album/SuperHeroineComixxx", AUTHOR],
      ["Karmagik Comics", "album/Karmagik-Comics", AUTHOR],
      ["Blacknwhite.com Comics", "album/Blacknwhite_com-Comics", AUTHOR],
      ["ArtOfJaguar Comics", "album/ArtOfJaguar-Comics", AUTHOR],
      ["Kirtu.com Comics", "album/Kirtu_com-Comics", AUTHOR],
      ["UberMonkey Comics", "album/UberMonkey-Comics", AUTHOR],
      ["DarkSoul3D Comics", "album/DarkSoul3D-Comics", AUTHOR],
      ["Markydaysaid Comics", "album/Markydaysaid-Comics", AUTHOR],
      ["Central Comics", "album/Central-Comics", AUTHOR],
      ["Frozen Parody Comics", "album/Frozen-Parody-Comics", AUTHOR],
      ["Blacknwhitecomics.com Comix", "album/Blacknwhitecomics_com-Comix", AUTHOR],
    ];
  }

  protected getSortList(): [string, string][] {
    return [
      ["Views", ""],
      ["Likes", "like"],
      ["Date", "date"],
      ["A-Z", "az"],
    ];
  }
}
