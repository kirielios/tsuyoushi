// Port of keiyoushi/extensions-source src/all/hentaifox/HentaiFox.kt
import { Filter, MangasPage, SManga, isNotBlank, urlWithoutDomain, type Document, type Element, type FilterList, type Response } from "../../../sdk/index.ts";
import {
  GalleryAdults,
  LANGUAGE_CHINESE,
  LANGUAGE_ENGLISH,
  LANGUAGE_JAPANESE,
  LANGUAGE_KOREAN,
  LANGUAGE_MULTI,
  LANGUAGE_TRANSLATED,
  SortOrderFilter,
  imgAttr,
  toDate,
  type SMangaDto,
} from "../../../themes/galleryadults/index.ts";

const sidebarCategoriesFilterStateMap: Record<string, string> = {
  "Top Rated": "top_rated",
  "Most Faved": "top_faved",
  "Most Fapped": "top_fapped",
  "Most Downloaded": "top_downloaded",
};

export default class HentaiFox extends GalleryAdults {
  protected override mangaLang = (() => {
    switch (this.lang) {
      case "en":
        return LANGUAGE_ENGLISH;
      case "ja":
        return LANGUAGE_JAPANESE;
      case "zh":
        return LANGUAGE_CHINESE;
      case "ko":
        return LANGUAGE_KOREAN;
      case "all":
        return LANGUAGE_MULTI;
      default:
        throw new Error(`Invalid lang: ${this.lang}`);
    }
  })();

  override get supportsLatest() {
    return isNotBlank(this.mangaLang);
  }

  protected override get xhrHeaders(): Headers {
    const h = this.headersBuilder();
    if (this.csrfToken != null) h.append("X-Csrf-Token", this.csrfToken);
    h.append("X-Requested-With", "XMLHttpRequest");
    return h;
  }

  private readonly languages: [string, string][] = [
    [LANGUAGE_ENGLISH, "1"],
    [LANGUAGE_TRANSLATED, "2"],
    [LANGUAGE_JAPANESE, "5"],
    [LANGUAGE_CHINESE, "6"],
    [LANGUAGE_KOREAN, "11"],
  ];
  private readonly langCode = this.languages.find((lang) => lang[0] === this.mangaLang)?.[1];

  protected override mangaLangOf(element: Element): string {
    const it = element.attr("data-languages").split(" ");
    if (this.langCode != null && it.includes(this.langCode)) return this.mangaLang;
    // search result doesn't have "data-languages" which will return a list with 1 blank element
    if (it.length > 1 || (it.length === 1 && isNotBlank(it[0]))) return "other";
    // if we don't know which language to filter then set to mangaLang to not filter at all
    return this.mangaLang;
  }

  protected getInfoSelector(tag: string) {
    return `ul.${tag.toLowerCase()} a`;
  }

  protected override getTime(element: Element): number {
    const t = element.selectFirst(".pages:contains(Posted:)")?.ownText();
    return toDate(t != null && t.startsWith("Posted: ") ? t.slice("Posted: ".length) : t, null);
  }

  protected override addPageUri(s: string, page: number): string {
    if (s === `${this.baseUrl}/` && page === 2) return `${s}page/${page}/`;
    if (s.includes("?")) return `${s}&page=${page}`;
    return `${s}/pag/${page}/`;
  }

  /**
   * Convert space( ) typed in search-box into plus(+) in URL. Then:
   * - ignore the word preceding by a special character (e.g. 'school-girl' will ignore 'girl')
   *    => replace to plus(+),
   * - use plus(+) for separate terms, as AND condition.
   * - use double quote(") to search for exact match.
   */
  protected override buildQueryString(tags: string[], query: string): string {
    const regexSpecialCharacters = /[^a-zA-Z0-9"]+(?=[a-zA-Z0-9"])/g;
    return [...tags, query, this.mangaLang]
      .filter(isNotBlank)
      .map((it) => it.trim().replace(regexSpecialCharacters, "+"))
      .join("+");
  }

  protected override favoritePath = "includes/user_favs.php";
  protected override pagesRequest = "includes/thumbs_loader.php";

  override getFilterList(data: unknown = null): FilterList {
    return [new Filter.Header('HINT: Use double quote (") for exact match'), ...super.getFilterList(data)];
  }

  private readonly sidebarPath = "includes/sidebar.php";

  private sidebarMangaSelector() {
    return "div.item";
  }

  private sidebarMangaTitle(element: Element) {
    return element.selectFirst("img")?.attr("alt") ?? null;
  }

  private sidebarMangaUrl(element: Element) {
    return element.selectFirst("a")?.attr("abs:href") ?? null;
  }

  private sidebarMangaThumbnail(element: Element) {
    const img = element.selectFirst("img");
    return img ? imgAttr(img) : null;
  }

  private csrfToken: string | null = null;

  private storeCsrf(document: Document) {
    this.csrfToken = document.select("[name=csrf-token]").attr("content");
  }

  protected override parsePopularManga(document: Document) {
    this.storeCsrf(document);
    return super.parsePopularManga(document);
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    // Sidebar mangas should always override any other search, so they should appear first
    // and only propagate to super when a "normal" search is issued
    const sortOrderFilter = filters.find((f): f is SortOrderFilter => f instanceof SortOrderFilter);

    if (sortOrderFilter) {
      const selectedCategory = sortOrderFilter.values[sortOrderFilter.state];
      if (selectedCategory in sidebarCategoriesFilterStateMap) {
        return this.parseSearchManga(await this.getSidebar(sidebarCategoriesFilterStateMap[selectedCategory] ?? "top_rated"));
      }
    }

    return super.getSearchMangaList(page, query, filters);
  }

  private getSidebar(category: string): Promise<Response> {
    const url = `${this.baseUrl}/${this.sidebarPath}`;
    return this.client.post(url, this.xhrHeaders, new URLSearchParams({ type: category }));
  }

  protected override parseSearchManga(response: Response): MangasPage {
    if (new URL(response.url).pathname.endsWith(this.sidebarPath)) {
      const document = response.asJsoup();

      const mangas = document
        .select(this.sidebarMangaSelector())
        .flatMap((it): SMangaDto[] => {
          const title = this.sidebarMangaTitle(it);
          if (title == null) return [];
          const url = this.sidebarMangaUrl(it);
          if (url == null) return [];
          return [{ title, url, thumbnail: this.sidebarMangaThumbnail(it), lang: LANGUAGE_MULTI }];
        })
        .map((it) => {
          const manga = SManga.create();
          manga.title = it.title;
          manga.url = urlWithoutDomain(it.url);
          manga.thumbnail_url = it.thumbnail ?? undefined;
          return manga;
        });

      return new MangasPage(mangas, false);
    }
    return super.parseSearchManga(response);
  }

  protected override getSortOrderURIs(): [string, string][] {
    return [...super.getSortOrderURIs(), ...Object.entries(sidebarCategoriesFilterStateMap)];
  }
}
