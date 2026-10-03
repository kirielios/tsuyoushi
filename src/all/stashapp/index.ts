// Port of keiyoushi/extensions-source src/all/stashapp/StashApp.kt (+ StashDto.kt)
import {
  EditTextPreference,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  graphQLBody,
  isNotBlank,
  parseGraphQLAs,
  substringAfterLast,
  substringBefore,
  tryParseInstant,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { CHAPTER_LIST_QUERY, MANGA_BRIEF_PER_PAGE, MANGA_BRIEF_QUERY, MANGA_DETAILS_QUERY, PAGE_LIST_QUERY, PREF_API_KEY } from "./constants.ts";

// --- StashDto.kt: types
type SortDirectionEnum = "ASC" | "DESC";
interface FindFilterType {
  q?: string | null;
  page?: number | null;
  per_page?: number | null;
  sort?: string | null;
  direction?: SortDirectionEnum | null;
}
interface VisualFile {
  __typename?: string | null;
}
interface Image {
  id?: string | null;
  paths?: { thumbnail?: string | null } | null;
  visual_files?: VisualFile[];
}
interface Gallery {
  id?: string | null;
  title?: string | null;
  folder?: { path?: string | null } | null;
  photographer?: string | null;
  details?: string | null;
  tags?: { name?: string }[] | null;
  cover?: Image | null;
  created_at?: string | null;
}

// --- Extension Mapping & Utilities
const notBlank = (s: string | null | undefined): string | undefined => (isNotBlank(s) ? s : undefined);

function pathLast(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--;
  return substringAfterLast(substringAfterLast(path.slice(0, end), "/"), "\\");
}

const urlLast = (url: string): string => pathLast(substringBefore(substringBefore(url, "?"), "#"));

function toAbsoluteUrl(baseUrl: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/")) return `${baseUrl}${path}`;
  return `${baseUrl}/${path}`;
}

const toTitle = (g: Gallery): string => notBlank(g.title) ?? (notBlank(g.folder?.path) != null ? pathLast(g.folder!.path!) : undefined) ?? g.id!;

function toThumbnailUrl(image: Image): string | undefined {
  if ((image.visual_files ?? [])[0]?.__typename !== "ImageFile") return undefined; // VisualFile.isImage()
  return notBlank(image.paths?.thumbnail);
}

function toMangaBrief(g: Gallery, baseUrl: string): SManga | null {
  const galleryId = notBlank(g.id);
  if (galleryId == null) return null;
  const m = SManga.create();
  m.url = toAbsoluteUrl(baseUrl, `/galleries/${galleryId}`);
  m.title = toTitle(g);
  m.thumbnail_url = g.cover ? toThumbnailUrl(g.cover) : undefined;
  return m;
}

function toMangaDetails(g: Gallery, baseUrl: string): SManga | null {
  const galleryId = notBlank(g.id);
  if (galleryId == null) return null;
  const m = SManga.create();
  m.url = toAbsoluteUrl(baseUrl, `/galleries/${galleryId}`);
  m.title = toTitle(g);
  m.artist = notBlank(g.photographer);
  m.author = m.artist;
  m.description = notBlank(g.details);
  m.genre = notBlank(
    (g.tags ?? [])
      .map((t) => t.name ?? "")
      .filter(isNotBlank)
      .join(", "),
  );
  m.status = SManga.UNKNOWN;
  m.thumbnail_url = g.cover ? toThumbnailUrl(g.cover) : undefined;
  // update_strategy ALWAYS_UPDATE is the default here
  m.initialized = true;
  return m;
}

function toPage(image: Image, index: number, baseUrl: string): Page | null {
  const imageId = notBlank(image.id);
  if (imageId == null) return null;
  return new Page(index, toAbsoluteUrl(baseUrl, `/images/${imageId}`), toAbsoluteUrl(baseUrl, `/image/${imageId}/image`));
}

// Stash is self-hosted: the base URL is the custom URL preference (meta.customUrl)
export default class StashApp extends KeiSource {
  protected override configureHeaders(headers: Headers): Headers {
    const key = this.preferences.getString(PREF_API_KEY, null);
    if (key != null && isNotBlank(key)) headers.append("ApiKey", key);
    return headers;
  }

  private get graphQlHeaders(): Headers {
    const h = new Headers(this.headers);
    h.append("Accept", "application/graphql-response+json, application/json");
    h.set("Content-Type", "application/json; charset=utf-8");
    return h;
  }

  // ============================== Popular ==============================

  getPopularManga(page: number): Promise<MangasPage> {
    return this.getMangaBrief(page, null, "rating", "DESC");
  }

  // ============================== Latest ===============================

  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getMangaBrief(page, null, "updated_at", "DESC");
  }

  // ============================== Search ===============================

  // TODO support getFilterList
  getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    return this.getMangaBrief(page, query, "path", "ASC");
  }

  // ============================== Details ==============================

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const id = urlLast(manga.url);

    const details = fetchDetails
      ? this.client
          .post(`${this.baseUrl}/graphql`, this.graphQlHeaders, graphQLBody({ operationName: "MangaDetails", query: MANGA_DETAILS_QUERY, variables: { id } }))
          .then((r) => toMangaDetails(parseGraphQLAs<{ findGallery: Gallery }>(r.text()).findGallery, this.baseUrl)!)
      : null;
    const chapterList = fetchChapters ? this.getChapterList(id) : null;

    const [d, c] = await Promise.all([details, chapterList]);
    return new SMangaUpdate(d ?? manga, c ?? chapters);
  }

  // ============================= Chapters ==============================

  private async getChapterList(id: string): Promise<SChapter[]> {
    const gallery = parseGraphQLAs<{ findGallery: Gallery }>(
      (await this.client.post(`${this.baseUrl}/graphql`, this.graphQlHeaders, graphQLBody({ operationName: "ChapterList", query: CHAPTER_LIST_QUERY, variables: { id } }))).text(),
    ).findGallery;

    const galleryId = gallery.id!;

    const chapter = SChapter.create();
    chapter.url = toAbsoluteUrl(this.baseUrl, `/galleries/${galleryId}`);
    chapter.name = "Chapter";
    chapter.date_upload = tryParseInstant(gallery.created_at);
    chapter.chapter_number = 1;
    chapter.scanlator = notBlank(gallery.photographer);
    return [chapter];
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const images = parseGraphQLAs<{ findImages: { images?: Image[] | null } }>(
      (
        await this.client.post(
          `${this.baseUrl}/graphql`,
          this.graphQlHeaders,
          graphQLBody({ operationName: "PageList", query: PAGE_LIST_QUERY, variables: { id: Number.parseInt(urlLast(chapter.url), 10) } }),
        )
      ).text(),
    ).findImages.images;
    if (!images) return [];

    return images.flatMap((image, index) => toPage(image, index, this.baseUrl) ?? []);
  }

  override imageRequest(page: Page) {
    const r = super.imageRequest(page);
    const headers = new Headers(r.headers);
    headers.set("Accept", "image/*");
    return { ...r, headers };
  }

  // ============================= Utilities =============================

  override getMangaUrl(manga: SManga): string {
    return manga.url;
  }

  override getChapterUrl(chapter: SChapter): string {
    return chapter.url;
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    // Base URL preference is now handled dynamically by the generated source
    const p = new EditTextPreference(screen.context);
    p.key = PREF_API_KEY;
    p.title = "API key";
    p.summary = "Settings | Security | Authentication | API Key";
    p.setDefaultValue("");
    screen.addPreference(p);
  }

  /** @param sort https://github.com/stashapp/stash/blob/v0.30.1/pkg/sqlite/gallery.go#L773 */
  private async getMangaBrief(page: number, q: string | null, sort: string | null, direction: SortDirectionEnum | null): Promise<MangasPage> {
    const filter: FindFilterType = { q, page, per_page: MANGA_BRIEF_PER_PAGE, sort, direction };
    const galleries = parseGraphQLAs<{ findGalleries: { galleries?: Gallery[] | null } }>(
      (await this.client.post(`${this.baseUrl}/graphql`, this.graphQlHeaders, graphQLBody({ operationName: "MangaBrief", query: MANGA_BRIEF_QUERY, variables: { filter } }))).text(),
    ).findGalleries.galleries;
    if (!galleries) return new MangasPage([], false);

    const mangas = galleries.flatMap((gallery) => toMangaBrief(gallery, this.baseUrl) ?? []);
    return new MangasPage(mangas, mangas.length >= MANGA_BRIEF_PER_PAGE);
  }
}
