// Port of keiyoushi/extensions-source src/en/atsumaru/Atsumaru.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  MultiSelectListPreference,
  Page,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  firstInstanceOrNull,
  toHttpUrl,
  toJsonElement,
  type ClientBuilder,
  type PreferenceScreen,
  type SChapter,
} from "../../../sdk/index.ts";
import {
  getFilterList,
  hasNextPage,
  recommendations,
  toSChapter,
  toSManga,
  type AllChaptersDto,
  type BrowseMangaDto,
  type FilterData,
  type MangaDto,
  type MangaObjectDto,
  type PageObjectDto,
  type SearchResultsDto,
} from "./dto.ts";
import { AdultFilter, GenreFilter, MinChaptersFilter, OfficialFilter, SortFilter, StatusFilter, TagFilters, TypeFilter, YearFilter } from "./filters.ts";

const PREF_SHOW_18 = "pref_18_mode";
const PREF_EXCLUDE_GENRES = "pref_exclude_genres";
const BROWSE_LIMIT = 40;
const PROTOCOL_REGEX = /^https?:?\/\//;

/** String.toIntOrNull() */
const toIntOrNull = (s: string): number | null => (/^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null);

export default class Atsumaru extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.rateLimit(2);
  }

  protected override configureHeaders(headers: Headers): Headers {
    headers.append("Accept", "*/*");
    headers.append("Content-Type", "application/json");
    return headers;
  }

  // ============================== Popular ===============================

  async getPopularManga(page: number): Promise<MangasPage> {
    const offset = (page - 1) * BROWSE_LIMIT;
    const data = (
      await this.client.get(`${this.baseUrl}/api/home2/popular?offset=${offset}&limit=${BROWSE_LIMIT}` + `&types=Manga,Manwha,Manhua,OEL&mediums=Comic&timeframe=daily${this.get18Mode()}${this.excludedGenresQuery()}`)
    ).parseAs<BrowseMangaDto>();

    return new MangasPage(
      data.items.map((it) => toSManga(it, this.baseUrl)),
      true,
    );
  }

  // =============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const offset = (page - 1) * BROWSE_LIMIT;
    const data = (
      await this.client.get(`${this.baseUrl}/api/home2/recentlyUpdated?offset=${offset}&limit=${BROWSE_LIMIT}` + `&types=Manga,Manwha,Manhua,OEL&mediums=Comic${this.get18Mode()}${this.excludedGenresQuery()}`)
    ).parseAs<BrowseMangaDto>();

    return new MangasPage(
      data.items.map((it) => toSManga(it, this.baseUrl)),
      true,
    );
  }

  // =============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.baseUrl}/collections/manga/documents/search`).newBuilder();
    builder.addQueryParameter("q", query || "*");

    const filterBy: string[] = [];
    filterBy.push("hidden:!=true");

    const includedGenres: string[] = [];
    const excludedGenres: string[] = [];
    const includedTags: string[] = [];
    const excludedTags: string[] = [];
    const typesList: string[] = [];
    const statuses: string[] = [];
    let year: number | null = null;
    let minChapters: number | null = null;
    let showAdult = false;
    let officialTranslation = false;
    let sortBy = "";

    for (const filter of filters) {
      if (filter instanceof GenreFilter) {
        filter.state.forEach((state, index) => {
          if (state.state === Filter.TriState.STATE_INCLUDE) includedGenres.push(filter.genreIds[index]);
          else if (state.state === Filter.TriState.STATE_EXCLUDE) excludedGenres.push(filter.genreIds[index]);
        });
      } else if (filter instanceof TagFilters) {
        for (const letter of filter.state) {
          letter.state.forEach((state, index) => {
            if (state.state === Filter.TriState.STATE_INCLUDE) includedTags.push(letter.tagIds[index]);
            else if (state.state === Filter.TriState.STATE_EXCLUDE) excludedTags.push(letter.tagIds[index]);
          });
        }
      } else if (filter instanceof TypeFilter) {
        filter.state.forEach((checkBox, index) => {
          if (checkBox.state) typesList.push(filter.ids[index]);
        });
      } else if (filter instanceof StatusFilter) {
        filter.state.forEach((checkBox, index) => {
          if (checkBox.state) statuses.push(filter.ids[index]);
        });
      } else if (filter instanceof YearFilter) {
        if (filter.state.length) year = toIntOrNull(filter.state);
      } else if (filter instanceof MinChaptersFilter) {
        if (filter.state.length) minChapters = toIntOrNull(filter.state);
      } else if (filter instanceof SortFilter) {
        const direction = filter.state!.ascending ? "asc" : "desc";
        sortBy = `${SortFilter.VALUES[filter.state!.index]}:${direction}`;
      } else if (filter instanceof AdultFilter) {
        showAdult = filter.state || this.get18Mode().length > 0;
      } else if (filter instanceof OfficialFilter) {
        officialTranslation = filter.state;
      }
    }

    if (includedGenres.length) filterBy.push(includedGenres.map((it) => `genreIds:=\`${it}\``).join(" && "));
    if (excludedGenres.length) filterBy.push(`genreIds:!=[${excludedGenres.map((it) => `\`${it}\``).join(",")}]`);

    if (includedTags.length) filterBy.push(includedTags.map((it) => `tagIds:=\`${it}\``).join(" && "));
    if (excludedTags.length) filterBy.push(`tagIds:!=[${excludedTags.map((it) => `\`${it}\``).join(",")}]`);

    if (typesList.length) filterBy.push(`type:=[${typesList.map((it) => `\`${it}\``).join(",")}]`);

    if (statuses.length) filterBy.push(`status:=[${statuses.map((it) => `\`${it}\``).join(",")}]`);

    if (year !== null) filterBy.push(`releaseYear:=[${year}]`);

    if (minChapters !== null) filterBy.push(`chapterCount:>=${minChapters}`);

    if (!showAdult) filterBy.push(`isAdult:=${showAdult}`);

    if (officialTranslation) filterBy.push(`officialTranslation:=${officialTranslation}`);

    filterBy.push("(mbContentRating:=[`Safe`,`Suggestive`,`Erotica`] || mbContentRating:!=*)");
    filterBy.push("medium:!=[`Novel`]");
    filterBy.push("views:>0");

    builder.addQueryParameter("filter_by", filterBy.join(" && "));

    if (sortBy.length) builder.addQueryParameter("sort_by", sortBy);

    if (query.length) {
      builder.addQueryParameter("query_by", "title,englishTitle,otherNames,authors");
      builder.addQueryParameter("query_by_weights", "4,3,2,1");
      builder.addQueryParameter("num_typos", "4,3,2,1");
    }

    builder.addQueryParameter("page", String(page));
    builder.addQueryParameter("per_page", "40");

    const body = (await this.client.get(builder.build().toString())).text();

    if (body.includes('"hits"')) {
      const data = JSON.parse(body) as SearchResultsDto;
      return new MangasPage(
        data.hits.map((it) => toSManga(it.document, this.baseUrl)),
        hasNextPage(data),
      );
    }
    const data = JSON.parse(body) as BrowseMangaDto;
    return new MangasPage(
      data.items.map((it) => toSManga(it, this.baseUrl)),
      true,
    );
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host) return null;
    const segments = url.pathname.slice(1).split("/");
    if (segments[0] !== "manga") return null;
    const id = segments[1];
    if (id === undefined) return null;

    const manga = SManga.create();
    manga.url = id;
    const update = await this.fetchMangaUpdate(manga, [], true, false);
    update.manga.initialized = true;
    return update.manga;
  }

  // =============================== Filters ===============================

  override get supportsFilterFetching(): boolean {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const filters = (await this.client.get(`${this.baseUrl}/api/explore/availableFilters`)).parseAs<FilterData>();
    return toJsonElement(filters);
  }

  override getFilterList(data: unknown = null): FilterList {
    const excludedGenres = this.preferences.getStringSet(PREF_EXCLUDE_GENRES, []);
    const filters = data ? getFilterList(data as FilterData, excludedGenres) : [];

    return FilterList(...filters, new YearFilter(), new MinChaptersFilter(), new SortFilter(), new AdultFilter(this.get18Mode().length > 0), new OfficialFilter());
  }

  // =========================== Manga Details ============================

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/manga/${manga.url}`;
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const detailsPromise: Promise<MangaDto | null> = (async () => {
      if (fetchDetails || fetchChapters) return (await this.client.get(`${this.baseUrl}/api/manga/page?id=${manga.url}`)).parseAs<MangaObjectDto>().mangaPage;
      return null;
    })();
    const chaptersPromise: Promise<AllChaptersDto | null> = (async () => {
      if (fetchChapters) return (await this.client.get(`${this.baseUrl}/api/manga/allChapters?mangaId=${manga.url}`)).parseAs<AllChaptersDto>();
      return null;
    })();

    const [details, chaptersDto] = await Promise.all([detailsPromise, chaptersPromise]);

    const updatedManga = fetchDetails && details ? toSManga(details, this.baseUrl) : manga;

    let updatedChapters = chapters;
    if (fetchChapters && chaptersDto) {
      const scanlatorMap = new Map((details?.scanlators ?? []).map((it) => [it.id, it.name]));
      updatedChapters = chaptersDto.chapters
        .map((it) => toSChapter(it, manga.url, it.scanlationMangaId != null ? scanlatorMap.get(it.scanlationMangaId) : undefined))
        // compareByDescending chapter_number, thenBy scanlator (nulls first), thenByDescending date_upload
        .sort((a, b) => {
          if (a.chapter_number !== b.chapter_number) return b.chapter_number - a.chapter_number;
          if (a.scanlator !== b.scanlator) {
            if (a.scanlator == null) return -1;
            if (b.scanlator == null) return 1;
            return a.scanlator < b.scanlator ? -1 : 1;
          }
          return b.date_upload - a.date_upload;
        });
    }

    return new SMangaUpdate(updatedManga, updatedChapters);
  }

  override get supportsRelatedMangas(): boolean {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    return recommendations((await this.client.get(`${this.baseUrl}/api/manga/page?id=${manga.url}`)).parseAs<MangaObjectDto>().mangaPage, this.baseUrl);
  }

  // ============================== Chapters ==============================

  override getChapterUrl(chapter: SChapter): string {
    const [slug, name] = chapter.url.split("/");
    return `${this.baseUrl}/read/${slug}/${name}`;
  }

  // =============================== Pages ================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const [slug, name] = chapter.url.split("/");
    const url = toHttpUrl(`${this.baseUrl}/api/read/chapter`).newBuilder().addQueryParameter("mangaId", slug).addQueryParameter("chapterId", name).build();

    return (await this.client.get(url.toString())).parseAs<PageObjectDto>().readChapter.pages.map((page, index) => {
      const imageUrl = page.image.startsWith("http") ? page.image : page.image.startsWith("//") ? `https:${page.image}` : `${this.baseUrl}/static/${page.image.replace(/^\//, "").replace(/^static\//, "")}`;
      return new Page(index, "", imageUrl.replace(PROTOCOL_REGEX, "https://cdn."));
    });
  }

  override imageRequest(page: Page) {
    const imgHeaders = this.headers;
    imgHeaders.set("Accept", "image/avif,image/webp,*/*");
    return { url: page.imageUrl!, headers: imgHeaders };
  }

  private get18Mode(): string {
    return this.preferences.getBoolean(PREF_SHOW_18, false) ? "&adult=1" : "";
  }

  private excludedGenresQuery(): string {
    const ids = this.preferences.getStringSet(PREF_EXCLUDE_GENRES, []);
    if (!ids.length) return "";
    return `&excludedTags=${ids.join(",")}`;
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const show18 = new SwitchPreferenceCompat();
    show18.key = PREF_SHOW_18;
    show18.title = "Toggle adult mode";
    // ponytail: summaryOff/summaryOn collapse to one summary (SDK has none for them)
    show18.summary = "Safe (default) / +18";
    screen.addPreference(show18);

    const genreFilter = firstInstanceOrNull(this.getFilterList(), GenreFilter);
    const genres = genreFilter?.state ?? [];
    const genreIds = genreFilter?.genreIds ?? [];

    const exclude = new MultiSelectListPreference();
    exclude.key = PREF_EXCLUDE_GENRES;
    exclude.title = "Exclude Genres from Browse";
    exclude.entries = genres.map((it) => it.name);
    exclude.entryValues = genreIds;
    exclude.setDefaultValue([]);
    const selected = this.preferences.getStringSet(PREF_EXCLUDE_GENRES, []);
    const entryMap = new Map(exclude.entryValues.map((v, i) => [v, exclude.entries[i]]));
    exclude.summary = selected.length ? selected.map((it) => entryMap.get(it) ?? it).join(", ") : "None";
    screen.addPreference(exclude);
  }
}
