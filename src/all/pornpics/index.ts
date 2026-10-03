// Port of keiyoushi/extensions-source src/all/pornpics/PornPics.kt (+ Preferences.kt, PornPicsExt.kt, Dto.kt)
import {
  Filter,
  FilterList,
  GET,
  HttpSource,
  ListPreference,
  MangasPage,
  Page,
  SChapter,
  SManga,
  firstInstance,
  toHttpUrl,
  urlWithoutDomain,
  type HttpUrlBuilder,
  type PreferenceScreen,
  type Request,
  type Response,
} from "../../../sdk/index.ts";
import { Intl } from "../../../libs/i18n/index.ts";
import {
  ActiveCategoryTypeSelector,
  SortSelector,
  createActiveCategoryTypeSelector,
  createCategorySelector,
  createChannelSelector,
  createPornStarSelector,
  createRecommendSelector,
  createSortSelector,
  createTagSelector,
} from "./filters.ts";
import { messages } from "./messages.ts";

// --- Dto.kt
interface MangaDto {
  desc: string;
  g_url: string;
  t_url: string;
}

// --- PornPicsExt.kt
const QUERY_PAGE_SIZE = 19;

// Add +1 to requested image count per page, compare actual received count with pageSize to determine next page.
const addQueryParameterPage = (b: HttpUrlBuilder, page: number) => b.addQueryParameter("limit", String(QUERY_PAGE_SIZE + 1)).addQueryParameter("offset", String((page - 1) * QUERY_PAGE_SIZE));

function addUrlPart(b: HttpUrlBuilder, urlPart: string | null, addPath = true, addQuery = true): HttpUrlBuilder {
  if (urlPart == null) return b;
  const httpUrl = toHttpUrl(`https://fake.com/${urlPart}`);
  if (addPath) for (const segment of httpUrl.pathSegments) b.addPathSegment(segment);
  if (addQuery) {
    const params = httpUrl.toURL().searchParams;
    for (const name of new Set(params.keys())) for (const value of params.getAll(name)) b.addQueryParameter(name, value);
  }
  return b;
}

// --- Preferences.kt
const PS_KEY_ROOT = "PornPics";
const PS_KEY_CATEGORY = `${PS_KEY_ROOT}::CATEGORY`;
const DEFAULT_CATEGORY_OPTION = "/default";

export default class PornPics extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  private _intl?: Intl;
  private get intl() {
    // meta.json builds only "en": zh messages and data are not bundled
    return (this._intl ??= new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en"], messages }));
  }

  private buildCategoryOption(): Map<string, string> {
    const intl = this.intl;
    return new Map([
      [intl.get("config-category-option-default"), DEFAULT_CATEGORY_OPTION],
      [intl.get("config-category-option-asian"), "asian"],
      [intl.get("config-category-option-chinese"), "chinese"],
      [intl.get("config-category-option-korean"), "korean"],
      [intl.get("config-category-option-japanese"), "japanese"],
      [intl.get("config-category-option-russian"), "russian"],
      [intl.get("config-category-option-ukrainian"), "ukrainian"],
      [intl.get("config-category-option-big-tits"), "big-tits"],
      [intl.get("config-category-option-natural-tits"), "natural-tits"],
      [intl.get("config-category-option-cosplay"), "cosplay"],
      [intl.get("config-category-option-cute"), "cute"],
      [intl.get("config-category-option-glasses"), "glasses"],
      [intl.get("config-category-option-maid"), "maid"],
      [intl.get("config-category-option-nurse"), "nurse"],
      [intl.get("config-category-option-nun"), "nun"],
      [intl.get("config-category-option-stockings"), "stockings"],
      [intl.get("config-category-option-twins"), "twins"],
    ]);
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const options = this.buildCategoryOption();
    const p = new ListPreference(screen.context);
    p.key = PS_KEY_CATEGORY;
    p.title = this.intl.get("config-category-title");
    p.summary = this.intl.get("config-category-summary");
    p.entries = [...options.keys()];
    p.entryValues = [...options.values()];
    screen.addPreference(p);
  }

  private getCategoryOption(): string | null {
    return this.preferences.getString(PS_KEY_CATEGORY, DEFAULT_CATEGORY_OPTION);
  }

  private readonly mangaSelector = "#main li.thumbwook > a.rel-link";

  private parseMangasPage(response: Response): MangasPage {
    const url = new URL(response.url);
    const isSearch = url.searchParams.get("q") != null;
    const isDefault = url.searchParams.get("period") != null;
    const offset = Number.parseInt(url.searchParams.get("offset")!, 10);
    const responseAsJson = isSearch || isDefault || offset > 0;

    let mangas: SManga[];
    if (responseAsJson) {
      mangas = response.parseAs<MangaDto[]>().map((it) => {
        const manga = SManga.create();
        manga.url = urlWithoutDomain(it.g_url);
        manga.title = it.desc;
        manga.thumbnail_url = it.t_url;
        return manga;
      });
    } else {
      mangas = response
        .asJsoup()
        .select(this.mangaSelector)
        .map((it) => {
          const imgEl = it.selectFirst("img")!;
          const manga = SManga.create();
          manga.url = urlWithoutDomain(it.absUrl("href"));
          manga.title = imgEl.attr("alt");
          manga.thumbnail_url = imgEl.absUrl("data-src");
          return manga;
        });
    }
    // response may be []. Add +1 to requested image count per page;
    // compare actual received count with pageSize to determine next page.
    const hasNextPage = mangas.length > QUERY_PAGE_SIZE;
    const readerMangas = hasNextPage ? mangas.slice(0, -1) : mangas;
    return new MangasPage(readerMangas, hasNextPage);
  }

  protected popularMangaRequest(page: number) {
    return this.buildMangasPageRequest(page, true);
  }
  protected popularMangaParse(response: Response) {
    return this.parseMangasPage(response);
  }

  protected latestUpdatesRequest(page: number) {
    return this.buildMangasPageRequest(page, false);
  }
  protected latestUpdatesParse(response: Response) {
    return this.parseMangasPage(response);
  }

  private buildMangasPageRequest(page: number, popular: boolean): Request {
    const categoryOption = this.getCategoryOption();
    if (DEFAULT_CATEGORY_OPTION === categoryOption) {
      // the source of is the options under the pics menu in the nav bar
      const period = popular ? 1 : 2;
      const categoryId = 2585 + period;
      const b = toHttpUrl(`${this.baseUrl}/popular/api/galleries/list/`).newBuilder();
      addQueryParameterPage(b, page).addQueryParameter("lang", this.intl.chosenLanguage).addQueryParameter("period", String(period)).addQueryParameter("category_id", String(categoryId));
      return GET(b.build(), this.headers);
    }

    // the source is the options under the categories/tags/pornstars/channels menu in the nav bar
    const requestBaseUrl = popular ? `${this.baseUrl}/${categoryOption}/` : `${this.baseUrl}/${categoryOption}/recent/`;
    const b = toHttpUrl(requestBaseUrl).newBuilder();
    addQueryParameterPage(b, page).addQueryParameter("lang", this.intl.chosenLanguage);
    return GET(b.build(), this.headers);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const thumbEl = document.selectFirst(this.mangaSelector)!;
    const imgEl = thumbEl.selectFirst("img")!;
    const infoEl = document.selectFirst("div.gallery-info.to-gall-info");

    const manga = SManga.create();
    manga.title = imgEl.attr("alt");
    // update_strategy ONLY_FETCH_ONCE has no equivalent here
    manga.status = SManga.COMPLETED;
    manga.author = infoEl
      ?.select("div.gallery-info__item:nth-child(2) a")
      .map((it) => it.text())
      .join(", ");
    manga.genre = infoEl
      ?.select("div.gallery-info__item:not(:nth-child(2)) a")
      .map((it) => it.text())
      .join(", ");
    manga.description = infoEl?.selectFirst("div.gallery-info__item:nth-child(4)")?.text();
    return manga;
  }

  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const chapter = SChapter.create();
    chapter.chapter_number = 0;
    chapter.url = urlWithoutDomain(manga.url);
    chapter.name = this.intl.get("chapter.name.default");
    return [chapter];
  }

  protected chapterListParse(): SChapter[] {
    throw new Error("UnsupportedOperationException");
  }

  protected pageListParse(response: Response): Page[] {
    return (response as Response).asJsoup().select(this.mangaSelector).map((element, index) => new Page(index, "", element.absUrl("href")));
  }

  protected imageUrlParse(): string {
    throw new Error("UnsupportedOperationException");
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    return query.trim() === "" ? this.buildCategoryRequest(page, filters) : this.buildSearchRequest(page, query, filters);
  }

  protected searchMangaParse(response: Response) {
    return this.parseMangasPage(response);
  }

  private buildCategoryRequest(page: number, filters: FilterList): Request {
    const activeCategoryTypeOption = firstInstance(filters, ActiveCategoryTypeSelector);
    const categoryOption = activeCategoryTypeOption.selectedCategoryOption(filters);
    const sortOption = firstInstance(filters, SortSelector);
    const builder = toHttpUrl(this.baseUrl).newBuilder();
    addUrlPart(builder, categoryOption.toUrlPart());
    builder.addQueryParameter("lang", this.intl.chosenLanguage);
    addUrlPart(builder, sortOption.toUriPart(), !categoryOption.useSearch());
    addQueryParameterPage(builder, page);
    return GET(builder.build(), this.headers);
  }

  private buildSearchRequest(page: number, query: string, filters: FilterList): Request {
    const sortOption = firstInstance(filters, SortSelector);
    const builder = toHttpUrl(`${this.baseUrl}/search/srch.php`).newBuilder();
    builder.addQueryParameter("lang", this.intl.chosenLanguage);
    addUrlPart(builder, sortOption.toUriPart(), false);
    addQueryParameterPage(builder, page);
    builder.addQueryParameter("q", query);
    return GET(builder.build(), this.headers);
  }

  override getFilterList(_data: unknown = null): FilterList {
    const intl = this.intl;
    return FilterList(
      createSortSelector(intl),
      new Filter.Separator(),
      new Filter.Header(intl.get("filter.header.ignored-when-search")),
      new Filter.Separator(),
      new Filter.Header(intl.get("filter.header.select-active-category-type")),
      createActiveCategoryTypeSelector(intl),
      new Filter.Separator(),
      new Filter.Header(intl.get("filter.header.select-category-type-param")),
      createRecommendSelector(intl),
      createCategorySelector(intl),
      createTagSelector(intl),
      createPornStarSelector(intl),
      createChannelSelector(intl),
    );
  }
}
