// Port of keiyoushi/extensions-source src/all/luscious/Luscious.kt (+ LusciousConstants.kt, LusciousDTO.kt)
import {
  CheckBoxPreference,
  ClientBuilder,
  GET,
  HttpSource,
  HttpUrl,
  ListPreference,
  MangasPage,
  Page,
  Response,
  SChapter,
  SManga,
  substringAfter,
  substringAfterLast,
  substringBefore,
  urlWithoutDomain,
  type FilterList,
  type PreferenceScreen,
  type Request,
} from "../../../sdk/index.ts";
import {
  AlbumSizeSelectFilter,
  AlbumTypeSelectFilter,
  ContentTypeSelectFilter,
  CreatorTextFilters,
  FILTER_VALUE_IGNORE,
  FavoriteTextFilters,
  GenreGroupFilter,
  InterestGroupFilter,
  LanguageGroupFilter,
  RestrictGenresSelectFilter,
  SelectionSelectFilter,
  SortBySelectFilter,
  TagTextFilters,
  findInstance,
  getSortFilters,
  toJsonObject,
  toLusLang,
  type Filter,
} from "./filters.ts";

// ============================== LusciousConstants.kt ==============================
const POPULAR_DEFAULT_SORT_STATE = 0;
const LATEST_DEFAULT_SORT_STATE = 6;
const SEARCH_DEFAULT_SORT_STATE = 0;

const oneLine = (s: string) => s.replaceAll("\n", " ").replace(/\s+/g, " ");

const ALBUM_LIST_REQUEST_GQL = oneLine(`
    query AlbumList($input: AlbumListInput!) {
        album {
            list(input: $input) {
                info {
                    page
                    has_next_page
                }
                items
            }
        }
    }
`);

const ALBUM_PICTURES_REQUEST_GQL = oneLine(`
    query AlbumListOwnPictures($input: PictureListInput!) {
        picture {
            list(input: $input) {
                info {
                    total_items
                    total_pages
                    page
                    has_next_page
                    items_per_page
                }
            items {
                created
                title
                url_to_original
                url_to_video
                position
                thumbnails {
                    url
                }
            }
        }
      }
    }
`);

const albumInfoQuery = `query AlbumGet($id: ID!) {
    album {
        get(id: $id) {
            ... on Album { ...AlbumStandard }
            ... on MutationError {
                errors {
                    code message
                 }
            }
        }
    }
}
fragment AlbumStandard on Album {
    __typename id title labels description created modified like_status number_of_favorites number_of_dislikes rating moderation_status marked_for_deletion marked_for_processing number_of_pictures number_of_animated_pictures number_of_duplicates slug is_manga url download_url permissions cover { width height size url } created_by { id url name display_name user_title avatar { url size } } content { id title url } language { id title url } tags { category text url count } genres { id title slug url } audiences { id title url url } last_viewed_picture { id position url } is_featured featured_date featured_by { id url name display_name user_title avatar { url size } }
}`;

const albumListRelatedQuery = `query AlbumListRelated($id: ID!) {
    album {
        list_related(id: $id) {
            more_like_this { ...AlbumInSearchList }
            items_liked_like_this { ...AlbumInSearchList }
            items_created_by_this_user { ...AlbumInSearchList }
        }
    }
}
fragment AlbumInSearchList on Album {
    title url cover { url }
}`;

const MERGE_CHAPTER_PREF_KEY = "MERGE_CHAPTER";
const MERGE_CHAPTER_PREF_TITLE = "Merge Chapter";
const MERGE_CHAPTER_PREF_SUMMARY =
  "If checked, merges all content of one album into chapters of up to 1000 images each, labeled as 'Merged Chapter (Part 1)', 'Merged Chapter (Part 2)', and so on. Note: you must be logged into the WebView to access more than 1000 images.";
const MERGE_CHAPTER_PREF_DEFAULT_VALUE = false;

const RESOLUTION_PREF_KEY = "RESOLUTION";
const RESOLUTION_PREF_TITLE = "Image resolution";
const RESOLUTION_PREF_ENTRIES = ["Low", "Medium", "High", "Original"];
const RESOLUTION_PREF_ENTRY_VALUES = ["2", "1", "0", "-1"];
const RESOLUTION_PREF_DEFAULT_VALUE = RESOLUTION_PREF_ENTRY_VALUES[3];

const SORT_PREF_KEY = "SORT";
const SORT_PREF_TITLE = "Page Sort";
const SORT_PREF_ENTRIES = ["Position", "Date", "Rating"];
const SORT_PREF_ENTRY_VALUES = ["position", "date_newest", "rating_all_time"];
const SORT_PREF_DEFAULT_VALUE = SORT_PREF_ENTRY_VALUES[0];

// ============================== LusciousDTO.kt ==============================
interface Info {
  has_next_page: boolean;
}
interface Cover {
  url: string;
  height: number;
  width: number;
}
interface Album {
  url: string;
  title: string;
  cover: Cover;
}
interface AlbumListResponse {
  data: { album: { list: { info: Info; items: Album[] } } };
}
interface AlbumRelatedResponse {
  data: {
    album: {
      list_related: { more_like_this: Album[] | null; items_liked_like_this: Album[] | null; items_created_by_this_user: Album[] | null };
    };
  };
}
interface FullAlbum {
  url: string;
  title: string;
  cover: Cover;
  description: string;
  language: { title: string } | null;
  labels: string[];
  genres: { title: string }[];
  audiences: { title: string }[];
  tags: { text: string }[];
  number_of_pictures: number;
  number_of_animated_pictures: number;
  content: { title: string };
  created?: number | null;
}
interface AlbumGetResponse {
  data: { album: { get: FullAlbum } };
}
interface Picture {
  thumbnails: Cover[];
  url_to_original: string | null;
  url_to_video: string | null;
  position: number;
  title: string;
  created: number;
}
interface AlbumListOwnPicturesResponse {
  data: { picture: { list: { info: Info; items: Picture[] } } };
}
interface PictureItem {
  index: number;
  url: string;
  title?: string | null;
  created?: number | null;
}
/**
 * Variables(Input(...)).toJsonString() with Mihon's Json (explicitNulls = false, no encodeDefaults): a null display
 * and items_per_page at its default of 50 are left out.
 */
function variablesJson(input: { display: string | null; page: number; itemsPerPage?: number; filters: Filter[] }): string {
  const out: Record<string, unknown> = {};
  if (input.display != null) out.display = input.display;
  out.page = input.page;
  if (input.itemsPerPage != null && input.itemsPerPage !== 50) out.items_per_page = input.itemsPerPage;
  out.filters = input.filters;
  return JSON.stringify({ input: out });
}

const albumToSManga = (it: Album): SManga => {
  const m = SManga.create();
  m.url = it.url;
  m.title = it.title;
  m.thumbnail_url = it.cover.url;
  return m;
};

const idFromUrl = (url: string) => substringAfterLast(url, "_").replace(/\/$/, "");

export default class Luscious extends HttpSource {
  override get supportsLatest() {
    return true;
  }
  get lusLang(): string {
    return toLusLang(this.lang);
  }

  private get apiBaseUrl(): string {
    return `${this.baseUrl}/graphql/nobatch/`;
  }
  private readonly cdnHost = "ah-img.luscious.net";

  override headersBuilder(): Headers {
    const h = super.headersBuilder();
    h.append("Referer", `${this.baseUrl}/`);
    return h;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(async (chain) => {
      const originalResponse = await chain.proceed(chain.request());
      if ((originalResponse.header("Content-Type") ?? "").includes("application/octet-stream") && originalResponse.url.includes(".webp")) {
        return Response.of(originalResponse.url, originalResponse.bytes(), "image/webp", originalResponse.code);
      }
      return originalResponse;
    });
  }

  // Common
  private buildAlbumListRequestInput(page: number, filters: FilterList, query = "") {
    const sortByFilter = findInstance(filters, SortBySelectFilter)!;
    const albumTypeFilter = findInstance(filters, AlbumTypeSelectFilter)!;
    const selectionFilter = findInstance(filters, SelectionSelectFilter)!;
    const interestsFilter = findInstance(filters, InterestGroupFilter)!;
    const languagesFilter = findInstance(filters, LanguageGroupFilter)!;
    const tagsFilter = findInstance(filters, TagTextFilters)!;
    const creatorFilter = findInstance(filters, CreatorTextFilters)!;
    const favoriteFilter = findInstance(filters, FavoriteTextFilters)!;
    const genreFilter = findInstance(filters, GenreGroupFilter)!;
    const contentTypeFilter = findInstance(filters, ContentTypeSelectFilter)!;
    const albumSizeFilter = findInstance(filters, AlbumSizeSelectFilter)!;
    const restrictGenresFilter = findInstance(filters, RestrictGenresSelectFilter)!;

    const list: Filter[] = [];
    if (contentTypeFilter.selected !== FILTER_VALUE_IGNORE) list.push(toJsonObject(contentTypeFilter, "content_id"));
    if (albumTypeFilter.selected !== FILTER_VALUE_IGNORE) list.push(toJsonObject(albumTypeFilter, "album_type"));
    if (selectionFilter.selected !== FILTER_VALUE_IGNORE) list.push(toJsonObject(selectionFilter, "selection"));
    if (albumSizeFilter.selected !== FILTER_VALUE_IGNORE) list.push(toJsonObject(albumSizeFilter, "picture_count_rank"));
    if (restrictGenresFilter.selected !== FILTER_VALUE_IGNORE) list.push(toJsonObject(restrictGenresFilter, "restrict_genres"));

    if (!interestsFilter.selected.length) throw new Error("Please select an Interest");
    list.push(toJsonObject(interestsFilter, "audience_ids"));

    if (this.lusLang !== FILTER_VALUE_IGNORE) list.push({ name: "language_ids", value: "+" + languagesFilter.selected.join("+") });

    if (tagsFilter.state) {
      const tags = `+${tagsFilter.state.toLowerCase()}`
        .replaceAll(" ", "_")
        .replaceAll("_,", "+")
        .replaceAll(",_", "+")
        .replaceAll(",", "+")
        .replaceAll("+-", "-")
        .replaceAll("-_", "-")
        .trim();
      list.push({ name: "tagged", value: tags });
    }

    if (creatorFilter.state) list.push({ name: "created_by_id", value: creatorFilter.state });
    if (favoriteFilter.state) list.push({ name: "favorite_by_user_id", value: favoriteFilter.state });
    if (genreFilter.anyNotIgnored()) list.push(toJsonObject(genreFilter, "genre_ids"));
    if (query !== "") list.push({ name: "search_query", value: query });

    return { display: sortByFilter.selected, page, itemsPerPage: 50, filters: list };
  }

  private buildAlbumListRequest(page: number, filters: FilterList, query = ""): Request {
    const input = this.buildAlbumListRequestInput(page, filters, query);
    const url = HttpUrl.parse(this.apiBaseUrl)
      .newBuilder()
      .addQueryParameter("operationName", "AlbumList")
      .addQueryParameter("query", ALBUM_LIST_REQUEST_GQL)
      .addQueryParameter("variables", variablesJson(input))
      .build();
    return GET(url, this.headers);
  }

  private parseAlbumListResponse(response: Response): MangasPage {
    const list = response.parseAs<AlbumListResponse>().data.album.list;
    return new MangasPage(list.items.map(albumToSManga), list.info.has_next_page);
  }

  private buildAlbumInfoRequest(id: string): Request {
    const url = HttpUrl.parse(this.apiBaseUrl)
      .newBuilder()
      .addQueryParameter("operationName", "AlbumGet")
      .addQueryParameter("query", albumInfoQuery)
      .addQueryParameter("variables", JSON.stringify({ id }))
      .build();
    return GET(url, this.headers);
  }

  private buildAlbumListRelatedRequest(id: string): Request {
    const url = HttpUrl.parse(this.apiBaseUrl)
      .newBuilder()
      .addQueryParameter("operationName", "AlbumListRelated")
      .addQueryParameter("query", albumListRelatedQuery)
      .addQueryParameter("variables", JSON.stringify({ id }))
      .build();
    return GET(url, this.headers);
  }

  // Latest

  protected latestUpdatesRequest(page: number): Request {
    return this.buildAlbumListRequest(page, getSortFilters(LATEST_DEFAULT_SORT_STATE, this.lusLang));
  }

  protected latestUpdatesParse(response: Response): MangasPage {
    return this.parseAlbumListResponse(response);
  }

  // Chapters

  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const id = idFromUrl(manga.url);

    const response = await this.executeSuccess(this.buildAlbumInfoRequest(id));
    const album = response.parseAs<AlbumGetResponse>().data.album.get;
    const totalPictures = album.number_of_pictures;

    if (this.getMergeChapterPref()) {
      const chapters: SChapter[] = [];
      const chunkCount = Math.max(Math.ceil(totalPictures / 1000.0), 1);

      for (let i = 1; i <= chunkCount; i++) {
        const chapter = SChapter.create();
        chapter.url = `${manga.url}?chunk=${i}`;
        chapter.name = chunkCount === 1 ? "Merged Chapter" : `Merged Chapter (Part ${i})`;
        chapter.chapter_number = i;
        chapter.date_upload = Math.trunc(album.created ?? 0) * 1000;
        chapters.push(chapter);
      }
      return chapters.reverse();
    }

    const chapters: SChapter[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      // upstream: GET(url) with no headers; the source headers are sent here
      const newPage = await this.client.execute(GET(this.buildAlbumPicturesPageUrl(id, page), this.headers));
      const data = newPage.parseAs<AlbumListOwnPicturesResponse>();
      const pictureItems = this.parsePictures(data);

      if (!pictureItems.length) {
        hasMore = false;
      } else {
        for (const it of pictureItems) {
          const chapter = SChapter.create();
          chapter.chapter_number = it.index;
          chapter.name = `${it.index} - ${it.title}`;
          chapter.date_upload = (it.created ?? 0) * 1000;
          chapter.url = urlWithoutDomain(it.url);
          chapters.push(chapter);
        }

        // API natively caps `total_items` tracking to 1000 so we override that by
        // directly tracking standard math iteration against the true `numberOfPictures`
        if (page * 50 >= totalPictures || !data.data.picture.list.items.length) hasMore = false;
        else page++;
      }
    }
    return chapters.reverse();
  }

  private getPictureUrl(picture: Picture): string {
    if (this.getResolutionPref() !== "-1") return picture.thumbnails[Number.parseInt(this.getResolutionPref()!, 10)].url;
    if (picture.url_to_video != null) return picture.url_to_video.replaceAll(".mp4", ".gif");
    if (picture.url_to_original != null) return picture.url_to_original;
    return picture.thumbnails.reduce((a, b) => (b.height * b.width > a.height * a.width ? b : a)).url;
  }

  private parsePictures(data: AlbumListOwnPicturesResponse): PictureItem[] {
    return data.data.picture.list.items.map((it) => {
      const url = this.getPictureUrl(it);
      return { index: it.position, url: url.startsWith("//") ? `https:${url}` : url, title: it.title, created: Math.trunc(it.created) };
    });
  }

  protected chapterListParse(_response: Response): SChapter[] {
    throw new Error("UnsupportedOperationException");
  }

  // Pages

  private buildAlbumPicturesPageUrl(id: string, page: number): HttpUrl {
    const input = { filters: [{ name: "album_id", value: id }], display: this.getSortPref(), page, itemsPerPage: 50 };
    return HttpUrl.parse(this.apiBaseUrl)
      .newBuilder()
      .addQueryParameter("operationName", "AlbumListOwnPictures")
      .addQueryParameter("query", ALBUM_PICTURES_REQUEST_GQL)
      .addQueryParameter("variables", variablesJson(input))
      .build();
  }

  override async fetchPageList(chapter: SChapter): Promise<Page[]> {
    if (!chapter.url.startsWith("/albums/")) return [new Page(0, "", `https://${this.cdnHost}${chapter.url}`)];

    const chunkNum = Number.parseInt(substringBefore(substringAfter(chapter.url, "?chunk=", "1"), "#"), 10);
    const chunk = Number.isNaN(chunkNum) ? 1 : chunkNum;
    const id = idFromUrl(substringBefore(chapter.url, "?"));

    const pages: Page[] = [];
    const startPage = (chunk - 1) * 20 + 1;
    const endPage = chunk * 20;

    for (let page = startPage; page <= endPage; page++) {
      const response = await this.client.execute(GET(this.buildAlbumPicturesPageUrl(id, page), this.headers));
      const data = response.parseAs<AlbumListOwnPicturesResponse>();
      const pictureItems = this.parsePictures(data);

      if (!pictureItems.length) break;

      for (const it of pictureItems) {
        const u = new URL(it.url);
        u.hostname = this.cdnHost;
        pages.push(new Page(pages.length, "", u.toString()));
      }

      if (pictureItems.length < 50) break;
    }
    return pages;
  }

  protected pageListParse(_response: Response): Page[] {
    throw new Error("UnsupportedOperationException");
  }

  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }

  override fetchImageUrl(_page: Page): Promise<string> {
    throw new Error("UnsupportedOperationException");
  }

  override getChapterUrl(chapter: SChapter): string {
    return chapter.url.startsWith("/albums/") ? `${this.baseUrl}${substringBefore(chapter.url, "?")}` : `https://${this.cdnHost}${chapter.url}`;
  }

  // Details

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(`${this.baseUrl}${manga.url}`, this.headers);
  }

  override async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const id = idFromUrl(manga.url);
    return this.detailsParse(await this.executeSuccess(this.buildAlbumInfoRequest(id)));
  }

  private detailsParse(response: Response): SManga {
    const data = response.parseAs<AlbumGetResponse>().data.album.get;
    const manga = SManga.create();
    manga.url = data.url;
    manga.title = data.title;
    manga.thumbnail_url = data.cover.url;
    manga.status = 0;
    manga.description = `${data.description}\n\nPictures: ${data.number_of_pictures}\nAnimated Pictures: ${data.number_of_animated_pictures}`;
    // Kotlin's joinToString prints a missing language as "null"
    const genreList: (string | null | undefined)[] = [data.language?.title];
    genreList.push(...data.labels);
    genreList.push(...data.genres.map((it) => it.title));
    genreList.push(...data.audiences.map((it) => it.title));
    genreList.push(...data.tags.map((it) => it.text));
    const artist = data.tags.find((it) => it.text.includes("Artist:"));
    if (artist != null) {
      manga.artist = substringAfter(artist.text, ":").trim();
      manga.author = manga.artist;
    }
    genreList.push(data.content.title);
    manga.genre = genreList.map((it) => String(it ?? null)).join(", ");
    return manga;
  }

  protected mangaDetailsParse(_response: Response): SManga {
    throw new Error("UnsupportedOperationException");
  }

  // Related

  protected override relatedMangaListRequest(manga: SManga): Request {
    return this.buildAlbumListRelatedRequest(idFromUrl(manga.url));
  }

  protected override async relatedMangaListParse(response: Response): Promise<SManga[]> {
    const r = response.parseAs<AlbumRelatedResponse>().data.album.list_related;
    return [r.more_like_this, r.items_liked_like_this, r.items_created_by_this_user].filter((it) => it != null).flatMap((items) => items.map(albumToSManga));
  }

  // Popular

  protected popularMangaParse(response: Response): MangasPage {
    return this.parseAlbumListResponse(response);
  }

  protected popularMangaRequest(page: number): Request {
    return this.buildAlbumListRequest(page, getSortFilters(POPULAR_DEFAULT_SORT_STATE, this.lusLang));
  }

  // Search

  protected searchMangaParse(response: Response): MangasPage {
    return this.parseAlbumListResponse(response);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    return this.buildAlbumListRequest(page, filters.length === 0 ? getSortFilters(SEARCH_DEFAULT_SORT_STATE, this.lusLang) : filters, query);
  }

  /** KeiSource routes pasted URLs here; upstream's fetchSearchManga handles them the same way. */
  protected override getMangasByUrl(url: URL, page: number): Promise<MangasPage> {
    return this.fetchSearchManga(page, url.toString(), []);
  }

  override async fetchSearchManga(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (query.startsWith("https://")) {
      const album = HttpUrl.parse(query).pathSegments[1];
      return this.fetchSearchManga(page, `ALBUM:${album}`, filters);
    }
    if (query.startsWith("ID:")) {
      const id = substringAfterLast(query, "ID:");
      return new MangasPage([this.detailsParse(await this.executeSuccess(this.buildAlbumInfoRequest(id)))], false);
    }
    if (query.startsWith("ALBUM:")) {
      const album = substringAfterLast(query, "ALBUM:");
      const id = album.split("_").at(-1)!;
      return new MangasPage([this.detailsParse(await this.executeSuccess(this.buildAlbumInfoRequest(id)))], false);
    }
    return super.fetchSearchManga(page, query, filters);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return getSortFilters(POPULAR_DEFAULT_SORT_STATE, this.lusLang);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    // the change listeners only write the same key again, which the app's settings form does itself
    const resolutionPref = new ListPreference();
    resolutionPref.key = `${RESOLUTION_PREF_KEY}_${this.lang}`;
    resolutionPref.title = RESOLUTION_PREF_TITLE;
    resolutionPref.entries = RESOLUTION_PREF_ENTRIES;
    resolutionPref.entryValues = RESOLUTION_PREF_ENTRY_VALUES;
    resolutionPref.setDefaultValue(RESOLUTION_PREF_DEFAULT_VALUE);
    resolutionPref.summary = "%s";

    const sortPref = new ListPreference();
    sortPref.key = `${SORT_PREF_KEY}_${this.lang}`;
    sortPref.title = SORT_PREF_TITLE;
    sortPref.entries = SORT_PREF_ENTRIES;
    sortPref.entryValues = SORT_PREF_ENTRY_VALUES;
    sortPref.setDefaultValue(SORT_PREF_DEFAULT_VALUE);
    sortPref.summary = "%s";

    const mergeChapterPref = new CheckBoxPreference();
    mergeChapterPref.key = `${MERGE_CHAPTER_PREF_KEY}_${this.lang}`;
    mergeChapterPref.title = MERGE_CHAPTER_PREF_TITLE;
    mergeChapterPref.summary = MERGE_CHAPTER_PREF_SUMMARY;
    mergeChapterPref.setDefaultValue(MERGE_CHAPTER_PREF_DEFAULT_VALUE);

    screen.addPreference(resolutionPref);
    screen.addPreference(sortPref);
    screen.addPreference(mergeChapterPref);
  }

  getMergeChapterPref(): boolean {
    return this.preferences.getBoolean(`${MERGE_CHAPTER_PREF_KEY}_${this.lang}`, MERGE_CHAPTER_PREF_DEFAULT_VALUE);
  }
  getResolutionPref(): string | null {
    return this.preferences.getString(`${RESOLUTION_PREF_KEY}_${this.lang}`, RESOLUTION_PREF_DEFAULT_VALUE);
  }
  getSortPref(): string | null {
    return this.preferences.getString(`${SORT_PREF_KEY}_${this.lang}`, SORT_PREF_DEFAULT_VALUE);
  }
}
