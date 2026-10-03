// Port of keiyoushi/extensions-source src/en/doujins/Doujins.kt (+ Dto.kt)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstance,
  substringAfter,
  substringBefore,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type FilterList as FilterListType,
} from "../../../sdk/index.ts";

// --- Dto.kt
interface FoldersDto {
  folders: FolderDto[];
}
interface FolderDto {
  link: string;
  name: string;
  artistList: string;
  tags: { tag: string }[];
  thumbnail2: string;
}

// --- filters
class UriPartFilter extends Filter.Select<string> {
  constructor(displayName: string, readonly vals: [string, string][]) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

class SeriesFilter extends UriPartFilter {
  constructor() {
    super("Series", [
      ["None", ""],
      ["None", ""],
      ["Doujins - Original Series", "/doujins-original-series-19934"],
      ["Hentai Magazine Chapters", "/hentai-magazine-chapters-2766"],
      ["Hentai Manga", "/hentai-manga-19"],
      ["Fate Grand Order", "/fate-grand-order-doujins-28615"],
      ["CG Sets - Original Series", "/cg-sets-original-series-14865"],
      ["Touhou", "/touhou-doujins-7748"],
      ["Naruto", "/naruto-doujins-5761"],
      ["Kantai Collection", "/kantai-collection-doujins-22720"],
      ["Hentai Game CG-Sets", "/hentai-game-cg-sets-2422"],
      ["One Piece", "/one-piece-doujins-6080"],
      ["Granblue Fantasy", "/granblue-fantasy-doujins-28177"],
      ["Azur Lane", "/azur-lane-doujins-34298"],
      ["Sword Art Online", "/sword-art-online-doujins-7246"],
      ["Idolmaster", "/idolmaster-4281"],
      ["My Hero Academia", "/my-hero-academia-doujins-28744"],
      ["Love Live", "/love-live-doujins-21865"],
      ["Pokemon", "/pokemon-doujins-6393"],
      ["Dragon Ball", "/dragon-ball-doujins-1238"],
      ["CGs - Mixed Series", "/cgs-mixed-series-35311"],
      ["Doujins - Mixed Series", "/doujins-mixed-series-20091"],
      ["Hentai Magazine Chapters", "/hentai-magazine-chapters-2766"],
      ["Hentai Magazine Chapters - Super-Shorts", "/hentai-magazine-chapters-super-shorts-19933"],
      ["Hentai Manga", "/hentai-manga-19"]
    ]);
  }
}

class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort", [
      ["Newest First", ""],
      ["Oldest First", "created_at"],
      ["Alphabetical", "name"],
      ["Rating", "-cached_score"],
      ["Popularity", "-cached_views"],
    ]);
  }
}

class PopularityPeriodFilter extends UriPartFilter {
  constructor() {
    super("Period", [
      ["This Month", "/top"],
      ["This Year", "/top/year"],
      ["All Time", "/top/all"],
    ]);
  }
}

const PAGE_DAYS = 3;
const ORDINAL_SUFFIXES = ["th", "st", "nd", "rd"];
const MANGA_DETAILS_DATE_FORMAT = ORDINAL_SUFFIXES.map((it) => DateTimeFormatter.ofPattern(`MMMM d'${it}', yyyy`, Locale.US));

// --- Doujins.kt
export default class Doujins extends KeiSource {
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.getMangaUrl(manga));
    const chapterUrl = response.url;
    const document = response.asJsoup();

    manga.title = document.select(".folder-title a").last()!.text();
    manga.artist = document.select(".gallery-artist a").map((it) => it.text()).join(", ");
    manga.author = manga.artist;
    manga.genre = document.select(".tag-area").first()!.select("a").map((it) => it.text()).join(", ");

    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.scanlator = substringAfter(document.select("div.folder-message:contains(Translated)").text(), "by:").trim();
    chapter.url = urlWithoutDomain(chapterUrl);

    const dateAndPageCountString = document.select(".text-md-right.text-sm-left > .folder-message").text();

    const date = substringBefore(dateAndPageCountString, " • ");
    for (const dateFormat of MANGA_DETAILS_DATE_FORMAT) {
      if (chapter.date_upload === 0) chapter.date_upload = dateFormat.tryParseDate(date);
      else break;
    }

    return new SMangaUpdate(manga, [chapter]);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const mangas = (await this.client.get(this.getLatestPageUrl(page))).parseAs<FoldersDto>().folders.map((it) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(it.link);
      manga.title = it.name;
      manga.artist = it.artistList;
      manga.author = manga.artist;
      manga.genre = it.tags.map((t) => t.tag).join(", ");
      manga.thumbnail_url = it.thumbnail2;
      return manga;
    });
    return new MangasPage(mangas, true);
  }

  private getLatestPageUrl(page: number): string {
    // LocalDate.now(ZoneOffset.UTC).plusDays(1).minusDays(PAGE_DAYS * (page - 1)) at the start of the day, UTC
    const now = new Date();
    const endMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1 - PAGE_DAYS * (page - 1));
    const endDateSec = endMs / 1000;
    const startDateSec = (endMs - PAGE_DAYS * 86_400_000) / 1000;

    return `${this.baseUrl}/folders?start=${startDateSec}&end=${endDateSec}`;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const response = await this.client.get(this.getChapterUrl(chapter));
    const pageUrl = response.url;
    const document = response.asJsoup();
    return document.select(".doujin").map((page, i) => new Page(i, `${pageUrl}${page.attr("data-link")}`, page.attr("data-file").replaceAll("amp;", "")));
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return this.parseGalleryPage((await this.client.get(`${this.baseUrl}/top/month`)).asJsoup());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const seriesFilter = firstInstance(filters, SeriesFilter);
    const sortFilter = firstInstance(filters, SortFilter);
    const popularityPeriodFilter = firstInstance(filters, PopularityPeriodFilter);

    let url: string;
    if (query !== "") {
      url = toHttpUrl(`${this.baseUrl}/searches`)!
        .newBuilder()
        .addQueryParameter("words", query)
        .addQueryParameter("page", String(page))
        .addQueryParameter("sort", sortFilter.toUriPart())
        .build()
        .toString();
    } else if (seriesFilter.toUriPart() !== "") {
      url = toHttpUrl(`${this.baseUrl}${seriesFilter.toUriPart()}`)!.newBuilder().addQueryParameter("sort", sortFilter.toUriPart()).build().toString();
    } else {
      url = toHttpUrl(`${this.baseUrl}${popularityPeriodFilter.toUriPart()}`)!.toString();
    }

    return this.parseGalleryPage((await this.client.get(url)).asJsoup());
  }

  private parseGalleryPage(document: Document): MangasPage {
    const pagination = document.select(".pagination").first();
    return new MangasPage(
      document.select("div:not(.premium-folder) > .thumbnail-doujin a.gallery-visited-from-favorites").map((it) => {
        const manga = SManga.create();
        manga.url = urlWithoutDomain(it.attr("href"));
        manga.title = it.select("div.title .text").text();
        const artist = it.parent()!.nextElementSibling()!.select(".single-line strong").last()?.text();
        manga.artist = artist == null ? undefined : substringAfter(artist, "Artist: ");
        manga.author = manga.artist;
        manga.thumbnail_url = it.select("img").attr("srcset");
        return manga;
      }),
      pagination != null ? !pagination.select("li.page-item:last-child").some((e) => e.hasClass("disabled")) : false,
    );
  }

  override getFilterList(_data: unknown = null): FilterListType {
    return FilterList(
      new Filter.Header("Text search ignores series and period filters"),
      new Filter.Separator(),

      new Filter.Header("Series filter overrides period filter"),
      new SeriesFilter(),
      new Filter.Separator(),

      new Filter.Header("Period filter only applies at initial page"),
      new PopularityPeriodFilter(),
      new Filter.Separator(),

      new Filter.Header("Sort only works with text search and series filter"),
      new SortFilter(),
    );
  }
}
