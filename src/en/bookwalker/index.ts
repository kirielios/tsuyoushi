// Port of keiyoushi/extensions-source src/en/bookwalker/BookWalker.kt (+ BookWalkerPrefs.kt, BookWalkerUtils.kt)
import { E4PInterceptor, E4PManifestReader } from "../../../libs/e4p/index.ts";
import { KeiSource, ListPreference, MangasPage, Page, SChapter, SManga, SMangaUpdate, SwitchPreferenceCompat, firstInstanceOrNull, substringAfter, substringBefore, toHttpUrl, type ClientBuilder, type FilterList, type PreferenceScreen, type Response } from "../../../sdk/index.ts";
import { decodeProto } from "../../../sdk/protobuf.ts";
import {
  ChapterType,
  ChaptersResponseSchema,
  MangaDetailsResponseSchema,
  SearchResponseSchema,
  SeriesFormat,
  SortDto,
  TagKind,
  ViewerResponseSchema,
  encodeChaptersRequest,
  encodeMangaDetailsRequest,
  encodeSearchRequest,
  encodeViewerRequest,
  getImageUrl,
  type ChapterDto,
  type ChaptersResponseDto,
  type FilterInfoDto,
  type MangaDetailsResponseDto,
  type MangaInfoDto,
  type SearchRequestDto,
  type SearchResponseDto,
  type ViewerResponse,
} from "./dto.ts";
import { BookWalkerFilters, SortFilter, TaggedTriState, TriStateFilter, type SearchFilter } from "./filters.ts";

// BookWalkerPrefs.kt
// const val PREF_SHOW_LIBRARY_IN_POPULAR = "showLibraryInPopular"
const PREF_USE_LATEST_THUMBNAIL = "useLatestThumbnail";

const FilterChaptersPref = {
  OWNED: "owned",
  OBTAINABLE: "obtainable",
  ALL: "all",
} as const;
type FilterChaptersPref = (typeof FilterChaptersPref)[keyof typeof FilterChaptersPref];
const FILTER_CHAPTERS_ORDER: FilterChaptersPref[] = [FilterChaptersPref.OWNED, FilterChaptersPref.OBTAINABLE, FilterChaptersPref.ALL];
const PREF_FILTER_CHAPTERS = "filterChapters";
const defaultOption = FilterChaptersPref.OBTAINABLE;
const fromKey = (key: string): FilterChaptersPref => FILTER_CHAPTERS_ORDER.find((it) => it === key) ?? defaultOption;
const includes = (self: FilterChaptersPref, other: FilterChaptersPref) => FILTER_CHAPTERS_ORDER.indexOf(self) >= FILTER_CHAPTERS_ORDER.indexOf(other);

const PAGE_SIZE = 60;

const PURCHASE_ICON = "💵"; // dollar bill emoji
const PREORDER_ICON = "🕑"; // two-o-clock emoji
const FREE_ICON = "🎁"; // wrapped present emoji

const tagToMarkdown: [RegExp, string][] = [
  [/<BR>/gi, "\n"],
  [/<\/?P>/gi, "\n"],
  [/<\/?B>/gi, "**"],
  [/<\/?I>/gi, "_"],
];

export class BookWalker extends KeiSource {
  // ID from before the BookWalker migration.

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(E4PInterceptor()).addChainInterceptor(async (chain) => {
      const request = chain.request();
      const response = await chain.proceed(request);
      if (response.code === 400 && new URL(request.url).pathname === "/api/kyon/kyon.v1.ReadService/Open") {
        throw new Error("Failed to load. You may need to log in via WebView and purchase it to view.");
      }
      return response;
    });
  }

  private get manifestReader() {
    return new E4PManifestReader(this.client, this.headers);
  }

  // Currently BookWalker does not support listing owned items by series anymore, but if in
  // the future that capability is added, it would be desirable to add this option back.

  get filterChapters(): FilterChaptersPref {
    return fromKey(this.preferences.getString(PREF_FILTER_CHAPTERS, defaultOption)!);
  }

  get useLatestThumbnail(): boolean {
    return this.preferences.getBoolean(PREF_USE_LATEST_THUMBNAIL, false);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const latest = new SwitchPreferenceCompat(screen.context);
    latest.key = PREF_USE_LATEST_THUMBNAIL;
    latest.title = "Use Latest Volume Cover For Thumbnail";
    latest.summary = "This does not affect browsing or series that don't have any volumes.";
    latest.setDefaultValue(false);
    screen.addPreference(latest);

    const filter = new ListPreference(screen.context);
    filter.key = PREF_FILTER_CHAPTERS;
    filter.title = "Filter Shown Chapters";
    filter.summary = "Choose what types of chapters to show.";
    filter.entries = ["Show owned and free chapters", "Show obtainable chapters", "Show all chapters"];
    filter.entryValues = [FilterChaptersPref.OWNED, FilterChaptersPref.OBTAINABLE, FilterChaptersPref.ALL];
    filter.setDefaultValue(defaultOption);
    screen.addPreference(filter);
  }

  private get filterInfo() {
    return new BookWalkerFilters(this);
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    return this.filterInfo.fetchGenres();
  }

  override getFilterList(data: unknown = null): FilterList {
    const genres = data as FilterInfoDto[] | null;
    if (genres == null) return [new SortFilter()];

    return [
      new SortFilter(),
      // Currently Webtoons aren't supported in-browser and so are tricky to support here.
      // Once they are working again, this can be re-enabled.
      // FormatFilter,
      new TriStateFilter(
        "Genres",
        "genres",
        genres.map((it) => new TaggedTriState(it.name, it.id)),
      ),
    ];
  }

  /** toProtoRequestBody(): BW wants application/proto rather than application/protobuf. */
  async protoPost(operation: string, body: Uint8Array): Promise<Response> {
    const headers = this.headers;
    headers.set("Content-Type", "application/proto");
    return this.client.post(this.endpoint(operation), headers, body);
  }

  private browse(page: number, sort: SortDto): SearchRequestDto {
    return {
      limitOffset: { limit: PAGE_SIZE, offset: PAGE_SIZE * (page - 1) },
      sort,
      formats: [SeriesFormat.MANGA],
      filters: [],
      searchDomain: "browse",
    };
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.toMangasPage(await this.protoPost("CollectionService/SearchV2", encodeSearchRequest(this.browse(page, SortDto.POPULAR))));
  }

  private toMangasPage(response: Response): MangasPage {
    const pageInfo = decodeProto<SearchResponseDto>(response.bytes(), SearchResponseSchema);
    const results = pageInfo.results.value;
    const c = pageInfo.countInfo;
    return new MangasPage(
      results.map((it) => this.mangaInfoToSManga(it.value, 720)),
      c.totalCount > (c.offset ?? 0) + c.limit,
    );
  }

  private mangaInfoToSManga(info: MangaInfoDto, thumbnailResolution: number): SManga {
    const manga = SManga.create();
    manga.url = this.mangaInfoUrl(info);
    manga.title = info.title;
    manga.thumbnail_url = info.thumbnail ? getImageUrl(info.thumbnail, thumbnailResolution) : undefined;
    manga.genre = info.tags
      .filter((it) => it.tagKind === TagKind.GENRE)
      .map((it) => it.name)
      .join(", ");
    return manga;
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.toMangasPage(await this.protoPost("CollectionService/SearchV2", encodeSearchRequest(this.browse(page, SortDto.NEWEST))));
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let request: SearchRequestDto = { ...this.browse(page, SortDto.LAST_UPDATED), query };
    for (const filter of filters) {
      if (filter instanceof SortFilter || filter instanceof TriStateFilter) request = (filter as SearchFilter).process(request);
    }
    return this.toMangasPage(await this.protoPost("CollectionService/SearchV2", encodeSearchRequest(request)));
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const volumeListRequest: Promise<ChapterDto[] | null> = (async () => {
      if (fetchChapters) return (await this.chapterList(manga, ChapterType.VOLUMES)).chapters;
      // Only wanted for the cover image here, so don't fail the update over it.
      if (fetchDetails && this.useLatestThumbnail) {
        try {
          return (await this.chapterList(manga, ChapterType.VOLUMES)).chapters;
        } catch {
          return null;
        }
      }
      return null;
    })();
    volumeListRequest.catch(() => undefined); // awaited below when needed; avoids an unhandled rejection

    const mangaDetails = (async () => {
      if (!fetchDetails) return manga;

      // Main details
      const details = decodeProto<MangaDetailsResponseDto>((await this.protoPost("ContentService/Details", encodeMangaDetailsRequest(this.toMangaId(manga.url)))).bytes(), MangaDetailsResponseSchema);

      const result = this.mangaInfoToSManga(details.info, 1200);
      result.status = details._status === 2 ? SManga.COMPLETED : SManga.ONGOING;

      // Replace simple HTML tags with markdown equivalent.
      result.description = tagToMarkdown.reduce((acc, [from, to]) => acc.replace(from, to), `${details.tagline ?? ""}\n\n${details.description ?? ""}`).trim();

      const joined = (name: string) => {
        const contents = details.metadata.find((it) => it.name === name)?.contents;
        return contents?.map((it) => it.name).join(", ");
      };
      result.author = joined("AUTHOR");
      result.artist = joined("ARTIST");

      if (this.useLatestThumbnail) {
        const thumb = (await volumeListRequest)
          ?.slice()
          .reverse()
          .find((it) => it.thumbnail)?.thumbnail;
        if (thumb) result.thumbnail_url = getImageUrl(thumb, 1200);
      }
      return result;
    })();

    const chapterList = (async () => {
      if (!fetchChapters) return chapters;

      const chaptersRequest = this.chapterList(manga, ChapterType.CHAPTERS).then((it) => it.chapters);

      const out: SChapter[] = [];
      for (const list of [(await volumeListRequest) ?? [], await chaptersRequest]) {
        const mapped: SChapter[] = [];
        for (const it of list) {
          if (!(it.releaseInfo._isAvailable === 1)) continue;

          const chapter = SChapter.create();
          chapter.url = this.chapterUrl(it);
          let suffix: string;
          if (it.releaseInfo._isReleased !== 1) {
            if (!includes(this.filterChapters, FilterChaptersPref.ALL)) continue;
            suffix = ` ${PREORDER_ICON}`;
          } else if (it._isOwned === 1) {
            suffix = "";
          } else if ((it.currentPrice ?? 0) === 0) {
            suffix = ` ${FREE_ICON}`;
          } else {
            if (!includes(this.filterChapters, FilterChaptersPref.OBTAINABLE)) continue;
            suffix = ` ${PURCHASE_ICON}`;
          }
          chapter.name = it.title + suffix;
          const num = parseFloat(it.chapterNumber.number);
          chapter.chapter_number = Number.isNaN(num) ? -1 : num;
          chapter.date_upload = it.releaseInfo.releaseDate.value * 1000;
          mapped.push(chapter);
        }
        out.push(...mapped.reverse());
      }
      return out;
    })();

    const [m, c] = await Promise.all([mangaDetails, chapterList]);
    return new SMangaUpdate(m, c);
  }

  private async chapterList(manga: SManga, chapterType: number): Promise<ChaptersResponseDto> {
    return decodeProto<ChaptersResponseDto>((await this.protoPost("ContentService/Children", encodeChaptersRequest(this.toMangaId(manga.url), chapterType))).bytes(), ChaptersResponseSchema);
  }

  override getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url;
  }
  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + substringBefore(chapter.url, "?");
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const chapterId = toHttpUrl(`${this.baseUrl}${chapter.url}`).pathSegments[1];
    const result = decodeProto<ViewerResponse>((await this.protoPost("ReadService/Open", encodeViewerRequest(`PRD_${chapterId}`))).bytes(), ViewerResponseSchema).details;

    const manifest = result.manifestUrl;
    switch (result.mimeType) {
      case "application/vnd.e4p.prpb+deflate+vnd.e4p.qst":
        return this.manifestReader.extractPagesFromEncryptedManifest(toHttpUrl(manifest));
      case "application/vnd.e4p.prpb":
        return this.manifestReader.extractPagesFromUnencryptedManifest(toHttpUrl(manifest));
      default:
        throw new Error(`Unknown manifest MIME type ${manifest}`);
    }
  }

  endpoint(operation: string): string {
    return `${this.baseUrl}/api/kyon/kyon.v1.${operation}`;
  }

  private mangaInfoUrl(info: MangaInfoDto) {
    return `/series/${substringAfter(info.id, "CNT_")}/${info.slug}`;
  }
  private toMangaId(url: string) {
    return "CNT_" + substringBefore(substringAfter(url, "/series/"), "/");
  }
  private chapterUrl(c: ChapterDto) {
    return `/read/${substringAfter(c.readId, "PRD_")}/${c.slug}`;
  }
}

export default BookWalker;
