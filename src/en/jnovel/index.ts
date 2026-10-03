// Port of keiyoushi/extensions-source src/en/jnovel/JNovel.kt (+ Dto.kt, Filters.kt)
import { E4PInterceptor, E4PManifestReader } from "../../../libs/e4p/index.ts";
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  extractNextJs,
  firstInstance,
  hasKeys,
  isBlank,
  toHttpUrl,
  type ClientBuilder,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";

// Dto.kt
interface SeriesItem {
  slug: string;
  title: string;
  cover: { coverUrl: string | null } | null;
}
interface SeriesResponse {
  seriesList: { series: SeriesItem[]; nextPageToken: string };
}
interface Creator {
  name: string | null;
  role: number | null;
}
interface Part {
  slug: string;
  title: string;
  launch: { seconds: string | null } | null;
  number: number | null;
  preview: boolean | null;
  rental: { expiresAt: { seconds: string | null } | null } | null;
}
interface Volume {
  parts?: Part[];
  volume: { creators: Creator[] | null; owned: boolean | null } | null;
}
interface SeriesDetails {
  title: string;
  description: string | null;
  tags: string[] | null;
  status: number | null;
  banner: { originalUrl: string | null } | null;
}
interface SeriesDetailsResponse {
  series: SeriesDetails;
  volumes: Volume[];
}

function seriesItemToSManga(item: SeriesItem): SManga {
  const manga = SManga.create();
  manga.url = item.slug;
  manga.title = item.title;
  const coverUrl = item.cover?.coverUrl;
  manga.thumbnail_url = coverUrl ? toHttpUrl(coverUrl).newBuilder().setPathSegment(2, "1200").build().toString() : undefined;
  return manga;
}

function seriesDetailsToSManga(d: SeriesDetails, creators: Creator[] | null): SManga {
  const manga = SManga.create();
  manga.title = d.title;
  manga.description = d.description ?? undefined;
  manga.genre = d.tags?.join(", ");
  switch (d.status) {
    case 0:
      manga.status = SManga.ONGOING;
      break;
    case 1:
      manga.status = SManga.COMPLETED;
      break;
    case 2:
      manga.status = SManga.ON_HIATUS;
      break;
    default:
      manga.status = SManga.UNKNOWN;
  }
  const names = (role: number) => {
    const list = creators?.filter((it) => it.role === role).flatMap((it) => (it.name != null ? [it.name] : []));
    return list && list.length > 0 ? list.join(", ") : undefined;
  };
  manga.author = names(1);
  manga.artist = names(4);
  manga.thumbnail_url = d.banner?.originalUrl ?? undefined;
  return manga;
}

const isLocked = (part: Part, owned: boolean) => !owned && part.preview === false && part.rental == null;

function partToSChapter(part: Part, mangaTitle: string, owned: boolean): SChapter {
  const chapter = SChapter.create();
  const lock = isLocked(part, owned) ? "🔒 " : "";
  const stripped = (part.title.startsWith(mangaTitle) ? part.title.slice(mangaTitle.length) : part.title).trim();
  const chapterName = stripped === "" ? part.title : stripped;
  chapter.url = part.slug;
  chapter.name = lock + chapterName;
  chapter.date_upload = part.launch?.seconds != null ? Number(part.launch.seconds) * 1000 : 0;
  chapter.chapter_number = part.number ?? -1;
  return chapter;
}

// Filters.kt
class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(displayName, vals.map((it) => it[0]));
  }
  get value(): string {
    return this.vals[this.state][1];
  }
}
class SortFilter extends SelectFilter {
  constructor() {
    super("Sort By", [
      ["Newest", ""],
      ["Oldest", "old"],
      ["A-Z", "asc"],
      ["Z-A", "desc"],
    ]);
  }
}
class LabelFilter extends SelectFilter {
  constructor() {
    super("Labels", [
      ["All Labels", ""],
      ["J-Novel Club", "club"],
      ["J-Novel Heart", "heart"],
      ["J-Novel Pulp", "pulp"],
      ["J-Novel Knight", "knight"],
    ]);
  }
}
class StatusFilter extends SelectFilter {
  constructor() {
    super("Publication Status", [
      ["Show All", ""],
      ["Ongoing", "ongoing"],
      ["Complete", "complete"],
      ["On Hiatus", "inactive"],
    ]);
  }
}
class RentalFilter extends SelectFilter {
  constructor() {
    super("Rentals", [
      ["Show All", ""],
      ["Available", "available"],
      ["Unavailable", "unavailable"],
    ]);
  }
}

const HIDE_LOCKED_PREF_KEY = "hide_locked";

export default class JNovel extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  private get domain() {
    return toHttpUrl(this.baseUrl).host;
  }
  private get viewerUrl() {
    return `https://labs.${this.domain}/embed/v2`;
  }
  private get manifestReader() {
    return new E4PManifestReader(this.client, this.headers);
  }
  private get rscHeaders() {
    const h = this.headersBuilder();
    h.set("rsc", "1");
    return h;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(E4PInterceptor()).addChainInterceptor(async (chain) => {
      const request = chain.request();
      const response = await chain.proceed(request);
      if (!response.isSuccessful && response.url.startsWith(this.viewerUrl)) {
        throw new Error("Log in via WebView and purchase this chapter to read.");
      }
      return response;
    });
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/series`).newBuilder().addQueryParameter("type", "manga").addQueryParameter("page", String(page)).build();
    return this.toMangasPage(await this.client.get(url.toString(), this.rscHeaders));
  }

  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.baseUrl}/series`).newBuilder();
    builder.addQueryParameter("type", "manga");
    if (!isBlank(query)) builder.addQueryParameter("search", query);
    const addFilter = (param: string, filter: SelectFilter) => {
      if (!isBlank(filter.value)) builder.addQueryParameter(param, filter.value);
    };
    addFilter("sort", firstInstance(filters, SortFilter));
    addFilter("label", firstInstance(filters, LabelFilter));
    addFilter("status", firstInstance(filters, StatusFilter));
    addFilter("rentals", firstInstance(filters, RentalFilter));

    return this.toMangasPage(await this.client.get(builder.build().toString(), this.rscHeaders));
  }

  private toMangasPage(response: Response): MangasPage {
    const result = extractNextJs<SeriesResponse>(response, hasKeys("seriesList"));
    const mangas = (result?.seriesList?.series ?? []).map(seriesItemToSManga);
    return new MangasPage(mangas, result ? result.seriesList.nextPageToken.length > 0 : false);
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const result = extractNextJs<SeriesDetailsResponse>(await this.client.get(this.getMangaUrl(manga), this.rscHeaders), hasKeys("series", "volumes"));
    if (result == null) throw new Error("Required value was null.");
    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF_KEY, false);
    const chapterList = result.volumes
      .flatMap((volume) => {
        const owned = volume.volume?.owned === true;
        return (volume.parts ?? []).filter((it) => !hideLocked || !isLocked(it, owned)).map((it) => partToSChapter(it, result.series.title, owned));
      })
      .reverse();

    const creators = result.volumes[0]?.volume?.creators ?? [];
    return new SMangaUpdate(seriesDetailsToSManga(result.series, creators), chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const embedUrl = document.selectFirst(`iframe[src^='${this.viewerUrl}']`)?.absUrl("src");
    if (!embedUrl) throw new Error("Log in via WebView and purchase this chapter to read.");
    const manifestUrl = (await this.client.get(`${embedUrl}/info.json`)).parseAs<{ "e4p-manifest": string }>()["e4p-manifest"];
    return this.manifestReader.extractPagesFromEncryptedManifest(toHttpUrl(manifestUrl));
  }

  override getMangaUrl(manga: SManga): string {
    return `${this.baseUrl}/series/${manga.url}`;
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/read/${chapter.url}`;
  }

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new SortFilter(), new LabelFilter(), new StatusFilter(), new RentalFilter());
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = HIDE_LOCKED_PREF_KEY;
    p.title = "Hide Locked Chapters";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }
}
