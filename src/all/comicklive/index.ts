// Port of keiyoushi/extensions-source src/all/comicklive/Comick.kt
import {
  Filter,
  KeiSource,
  MangasPage,
  MultiSelectListPreference,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstance,
  firstInstanceOrNull,
  parseAs,
  parseHtml,
  toHttpUrl,
  tryParseInstant,
  type ClientBuilder,
  type FilterList,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { browseComicToSManga, comicTitles, type ChapterList, type ComicData, type Data, type BrowseComic, type Metadata, type PageListData, type SearchResponse } from "./dto.ts";
import {
  ContentRatingFilter,
  CreatedAtFilter,
  DemographicFilter,
  GenreFilter,
  MinimumChaptersFilter,
  ReleaseFrom,
  ReleaseTo,
  SortFilter,
  StatusFilter,
  TagFilterText,
  TagFilters,
  TypeFilter,
} from "./filters.ts";

const LANGUAGE_WHITELIST = "language_whitelist";
const LANGUAGES: [string, string][] = [
  ["English", "en"],
  ["Russian", "ru"],
  ["Vietnamese", "vi"],
  ["French", "fr"],
  ["Polish", "pl"],
  ["Indonesian", "id"],
  ["Turkish", "tr"],
  ["Italian", "it"],
  ["Spanish", "es"],
  ["Ukrainian", "uk"],
  ["German", "de"],
  ["Korean", "ko"],
  ["Thai", "th"],
  ["Romanian", "ro"],
  ["Malay", "ms"],
  ["Japanese", "ja"],
  ["Swedish", "sv"],
  ["Norwegian", "no"],
];

export default class Comick extends KeiSource {
  protected override configureClient(builder: ClientBuilder) {
    return builder
      .addChainInterceptor(async (chain) => {
        const request = chain.request();

        let response = await chain.proceed(request);
        let retries = 0;

        while (response.code === 429 && retries++ < 10) {
          await new Promise((r) => setTimeout(r, 500));
          response = await chain.proceed({ ...request, url: toHttpUrl(request.url).newBuilder().fragment("retry").build().toString() });
        }
        return response;
      })
      .rateLimit(2, 1000, (it) => it.hash !== "#retry" && !it.pathname.split("/").includes("covers"));
  }

  override async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/api/comics/top`).newBuilder();
    let days: number;
    if (page === 1 || page === 4) days = 7;
    else if (page === 2 || page === 5) days = 30;
    else if (page === 3 || page === 6) days = 90;
    else throw new Error("UnsupportedOperationException");
    let type: string;
    if (page >= 1 && page <= 3) type = "follow";
    else if (page >= 4 && page <= 6) type = "most_follow_new";
    else throw new Error("UnsupportedOperationException");
    url.addQueryParameter("days", String(days));
    url.addQueryParameter("type", type);

    const data = (await this.client.get(url.build().toString())).parseAs<Data<BrowseComic[]>>();

    return new MangasPage(data.data.map(browseComicToSManga), page < 6);
  }

  private latestNextCursor: string | null = null;
  private searchNextCursor: string | null = null;

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    if (page === 1) this.latestNextCursor = null;

    const url = toHttpUrl(`${this.baseUrl}/api/chapters/latest`).newBuilder();
    url.addQueryParameter("order", "new");
    url.addQueryParameter("page", String(page));
    if (page > 1) url.addQueryParameter("cursor", this.latestNextCursor);

    const data = (await this.client.get(url.build().toString())).parseAs<SearchResponse>();

    this.latestNextCursor = data.next_cursor ?? null;

    return new MangasPage(data.data.map(browseComicToSManga), data.next_cursor != null);
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    return this.parseDetails(await this.client.get(url));
  }

  private readonly spaceSlashRegex = /[ /]/g;
  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (page === 1) this.searchNextCursor = null;

    const url = toHttpUrl(`${this.baseUrl}/api/search`).newBuilder();
    {
      const it = firstInstance(filters, SortFilter);
      url.addQueryParameter("order_by", it.selected);
      url.addQueryParameter("order_direction", it.state!.ascending ? "asc" : "desc");
    }
    const genre = firstInstanceOrNull(filters, GenreFilter);
    if (genre) {
      genre.included.forEach((it) => url.addQueryParameter("genres", it));
      genre.excluded.forEach((it) => url.addQueryParameter("excludes", it));
    }
    const text = firstInstanceOrNull(filters, TagFilterText);
    if (text) {
      text.state
        .split(",")
        .filter((it) => it.trim())
        .forEach((it) => {
          const value = it.trim().toLowerCase().replace(this.spaceSlashRegex, "-");
          url.addQueryParameter(value.startsWith("-") ? "excluded_tags" : "tags", value.replace("-", ""));
        });
    }
    const tags = firstInstanceOrNull(filters, TagFilters);
    if (tags) {
      tags.state.forEach((letter) => {
        letter.included.forEach((it) => url.addQueryParameter("tags", it));
        letter.excluded.forEach((it) => url.addQueryParameter("excluded_tags", it));
      });
    }
    firstInstance(filters, DemographicFilter).checked.forEach((it) => url.addQueryParameter("demographic", it));
    const time = firstInstance(filters, CreatedAtFilter).selected;
    if (time != null) url.addQueryParameter("time", time);
    firstInstance(filters, TypeFilter).checked.forEach((it) => url.addQueryParameter("country", it));
    {
      const it = firstInstance(filters, MinimumChaptersFilter).state;
      if (it.trim()) {
        if (!/^[+-]?\d+$/.test(it) || !Number.isSafeInteger(Number(it)) || Math.abs(Number(it)) > 2147483647) {
          throw new Error(`Invalid minimum chapters value: ${it}`);
        }
        url.addQueryParameter("minimum", it);
      }
    }
    const status = firstInstance(filters, StatusFilter).selected;
    if (status != null) url.addQueryParameter("status", status);
    const from = firstInstance(filters, ReleaseFrom).selected;
    if (from != null) url.addQueryParameter("from", from);
    const to = firstInstance(filters, ReleaseTo).selected;
    if (to != null) url.addQueryParameter("to", to);
    const rating = firstInstance(filters, ContentRatingFilter).selected;
    if (rating != null) url.addQueryParameter("content_rating", rating);
    url.addQueryParameter("showAll", "false");
    url.addQueryParameter("exclude_mylist", "false");
    if (query.trim()) {
      if (query.trim().length < 3) {
        throw new Error("Query must be at least 3 characters");
      }
      url.addQueryParameter("q", query.trim());
    }
    url.addQueryParameter("type", "comic");
    if (page > 1) {
      url.addQueryParameter("cursor", this.searchNextCursor);
    }

    const data = (await this.client.get(url.build().toString())).parseAs<SearchResponse>();

    this.searchNextCursor = data.next_cursor ?? null;

    return new MangasPage(data.data.map(browseComicToSManga), data.next_cursor != null);
  }

  override getMangaUrl(manga: SManga) {
    return `${this.baseUrl}/comic/${manga.url}`;
  }

  override async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([
      fetchDetails ? this.client.get(this.getMangaUrl(manga)).then((it) => this.parseDetails(it)) : Promise.resolve(manga),
      fetchChapters ? this.getChapterList(manga) : Promise.resolve(chapters),
    ]);
    return new SMangaUpdate(details, chapterList);
  }

  private parseDetails(response: Response): SManga {
    const data = parseAs<ComicData>(response.asJsoup().selectFirst("#comic-data")!.data());

    const manga = SManga.create();
    manga.title = data.title;
    manga.url = data.slug;
    manga.thumbnail_url = data.default_thumbnail;
    switch (data.status) {
      case 1:
        manga.status = SManga.ONGOING;
        break;
      case 2:
        manga.status = data.translation_completed ? SManga.COMPLETED : SManga.PUBLISHING_FINISHED;
        break;
      case 3:
        manga.status = SManga.CANCELLED;
        break;
      case 4:
        manga.status = SManga.ON_HIATUS;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    manga.author = data.authors.map((it) => it.name).join(", ");
    manga.artist = data.artists.map((it) => it.name).join(", ");

    let description = "";
    const des = parseHtml(this.host.load, data.desc, this.baseUrl)
      .wholeText()
      .replace(/\s+/g, " ") // collapse multiple whitespaces into a single space
      .replace(/(?<=[^.]{12})(?<!\bMr|\bMs|\bMrs|\bDr|\bProf|\bSr|\bJr|\bVol|\bCh)\.\s+/g, ".\n\n") // insert line breaks after periods
      .replace(/(?<=[^:]{12})(?<!\b[a-zA-Z]{1,10}):\s+/g, ":\n\n") // insert line breaks after colons
      .trim();
    description += des;
    const titles = comicTitles(data);
    if (titles.length) {
      description += "\n\n Alternative Titles: \n";
      titles.forEach((it) => (description += `- ${it.title.trim()}\n`));
    }
    manga.description = description.trim();

    const genre: string[] = [];
    if (data.country === "jp") genre.push("Manga");
    else if (data.country === "cn") genre.push("Manhua");
    else if (data.country === "ko") genre.push("Manhwa");
    if (data.content_rating === "suggestive") genre.push("Content Rating: Suggestive");
    else if (data.content_rating === "erotica") genre.push("Content Rating: Erotica");
    genre.push(...data.md_comic_md_genres.map((it) => it.md_genres.name));
    manga.genre = genre.join(", ");
    return manga;
  }

  private async getChapterList(manga: SManga): Promise<SChapter[]> {
    const whitelist = this.languageWhitelist;
    const langParam = whitelist.length === 1 ? `?lang=${whitelist[0]}` : "";
    const url = `${this.baseUrl}/api/comics/${manga.url}/chapter-list${langParam}`;

    const data = (await this.client.get(url)).parseAs<ChapterList>();
    const chapters = [...data.data];

    const rest = await Promise.all(
      Array.from({ length: Math.max(0, data.pagination.last_page - 1) }, (_, i) => {
        const pageUrl = toHttpUrl(url)
          .newBuilder()
          .addQueryParameter("page", String(i + 2))
          .build();
        return this.client.get(pageUrl.toString()).then((it) => it.parseAs<ChapterList>().data);
      }),
    );
    rest.forEach((it) => chapters.push(...it));

    return chapters
      .filter((it) => !whitelist.length || whitelist.includes(it.lang))
      .map((it) => {
        const chapter = SChapter.create();
        chapter.url = `/comic/${manga.url}/${it.hid}-chapter-${it.chap}-${it.lang}`;
        let name = "";
        if (it.vol != null && it.vol.trim()) name += `Vol. ${it.vol} `;
        name += `Ch. ${it.chap}`;
        if (it.title != null && it.title.trim()) name += `: ${it.title}`;
        chapter.name = name;
        chapter.date_upload = tryParseInstant(it.created_at);
        chapter.scanlator = it.group_name.join(", ");
        return chapter;
      });
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const data = parseAs<PageListData>((await this.client.get(this.getChapterUrl(chapter))).asJsoup().selectFirst("#sv-data")!.data());
    return data.chapter.images.map((image, index) => new Page(index, "", image.url));
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return (await this.client.get(`${this.baseUrl}/api/metadata`)).parseAs<Metadata>();
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [new SortFilter(), new DemographicFilter(), new TypeFilter()];

    const metadata = data as Metadata | null;
    if (metadata?.genres?.length) filters.push(new GenreFilter(metadata.genres));
    if (metadata?.tags?.length) filters.push(new TagFilters(metadata.tags));

    filters.push(
      new Filter.Separator(),
      new Filter.Header("Separate tags with commas (,)"),
      new Filter.Header("Prepend with dash (-) to exclude"),
      new TagFilterText(),
      new Filter.Separator(),
      new CreatedAtFilter(),
      new MinimumChaptersFilter(),
      new StatusFilter(),
      new ContentRatingFilter(),
      new ReleaseFrom(),
      new ReleaseTo(),
    );

    return filters;
  }

  private get languageWhitelist(): string[] {
    return this.preferences.getStringSet(LANGUAGE_WHITELIST, ["en"]);
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new MultiSelectListPreference(screen.context);
    p.key = LANGUAGE_WHITELIST;
    p.title = "Chapter Languages";
    p.summary = "Leave empty for All";
    p.entries = LANGUAGES.map((it) => it[0]);
    p.entryValues = LANGUAGES.map((it) => it[1]);
    p.setDefaultValue(["en"]);
    screen.addPreference(p);
  }
}
