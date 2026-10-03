// Port of keiyoushi/extensions-source src/en/hentaitnt/HentaiTnT.kt (+ Filters.kt, Dto.kt)
import { CheckBoxPreference, Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, parseHtml, toHttpUrl, urlWithoutDomain, type Document, type PreferenceScreen } from "../../../sdk/index.ts";

const HIDE_VIP_PREF = "hide_vip_chapters";

// --- Filters.kt
const genres: [string, string][] = [
  ["All", ""],
  ["Action", "action"],
  ["Adult", "adult"],
  ["BL", "bl"],
  ["Comedy", "comedy"],
  ["Doujinshi", "doujinshi"],
  ["Harem", "harem"],
  ["Horror", "horror"],
  ["Manga", "manga"],
  ["Manhwa", "manhwa"],
  ["Mature", "mature"],
  ["NTR", "ntr"],
  ["Romance", "romance"],
  ["Uncensore", "uncensore"],
  ["Webtoon", "webtoon"],
];

class Filters extends Filter.Select<string> {
  constructor() {
    super(
      "Genre",
      genres.map((it) => it[0]),
    );
  }
  get selectedId(): string {
    return genres[this.state][1];
  }
}

// --- Dto.kt
interface Dto {
  data: { html: string };
}

/** JsonObject.getStringOrNull */
const getStringOrNull = (memo: Record<string, unknown>, key: string): string | null => (typeof memo[key] === "string" ? (memo[key] as string) : null);

export default class HentaiTnT extends KeiSource {
  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/recommended${page > 1 ? `/page/${page}` : ""}`)).asJsoup();
    return this.mangaListParse(document);
  }

  private mangaListParse(document: Document): MangasPage {
    const mangas = document.select(".comic-card a").map((element) => {
      const manga = SManga.create();
      manga.url = urlWithoutDomain(element.attr("href"));
      manga.title = element.attr("title");
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
      return manga;
    });
    const hasNextPage = document.selectFirst("a[title=Next]") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/latest-updates${page > 1 ? `/page/${page}` : ""}`)).asJsoup();
    return this.mangaListParse(document);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(this.baseUrl).newBuilder();
    if (query.length > 0) {
      url.addQueryParameter("s", query);
    } else {
      const genreFilter = firstInstanceOrNull(filters, Filters);
      if (genreFilter != null) {
        const genreId = genreFilter.selectedId;
        if (genreId.length > 0) {
          url.addPathSegment("genre");
          url.addPathSegment(genreId);
        }
      }
    }
    if (page > 1) {
      url.addPathSegment("page");
      url.addPathSegment(String(page));
    }

    const document = (await this.client.get(url.build().toString())).asJsoup();
    return this.mangaListParse(document);
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const mangaId = getStringOrNull(manga.memo, "id");

    if (!fetchChapters) {
      const updatedManga = fetchDetails ? await this.fetchMangaDetails(manga) : manga;
      return new SMangaUpdate(updatedManga, chapters);
    }

    if (mangaId == null) {
      const updatedManga = await this.fetchMangaDetails(manga);
      const newId = getStringOrNull(updatedManga.memo, "id");
      if (newId == null) throw new Error("Failed to get chapter id");
      const updatedChapters = await this.fetchChapters(newId);
      return new SMangaUpdate(updatedManga, updatedChapters);
    }

    if (!fetchDetails) return new SMangaUpdate(manga, await this.fetchChapters(mangaId));

    // `mangaId` is stale but stable, requesting both at the same time for performance
    const [details, chapterList] = await Promise.all([this.fetchMangaDetails(manga), this.fetchChapters(mangaId)]);
    return new SMangaUpdate(details, chapterList);
  }

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const detailsDocument = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const details = SManga.create();
    details.author = detailsDocument.selectFirst("i[title=Artists] + span a")?.text();
    details.description = detailsDocument.selectFirst("#synopsisText")?.text();
    details.genre = detailsDocument
      .select(".genre-item")
      .map((it) => it.text())
      .join(", ");
    switch (detailsDocument.selectFirst("span:has(i[title=Status])")?.text().toLowerCase()) {
      case "completed":
        details.status = SManga.COMPLETED;
        break;
      case "ongoing":
        details.status = SManga.ONGOING;
        break;
      default:
        details.status = SManga.UNKNOWN;
    }

    const mangaId = detailsDocument.selectFirst("#post_manga_id")?.attr("value");
    details.memo = { id: mangaId ?? null };
    return details;
  }

  private async fetchChapters(mangaId: string): Promise<SChapter[]> {
    const form = new URLSearchParams({ action: "baka_ajax", type: "load_chapters_paginated", parent_id: mangaId, per_page: "10000", order: "newest_first" });

    const dto = (await this.client.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, undefined, form)).parseAs<Dto>();
    const chapterDoc = parseHtml(this.host.load, dto.data.html, this.baseUrl);

    const chapters: SChapter[] = [];
    for (const element of chapterDoc.select(".comic-card")) {
      const link = element.selectFirst("a");
      if (!link) continue;
      const isVip = element.selectFirst(".fa-crown") != null;

      if (isVip && this.preferences.getBoolean(HIDE_VIP_PREF, false)) continue;

      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(link.absUrl("href"));
      chapter.name = (isVip ? "🔒 " : "") + link.attr("title");
      chapters.push(chapter);
    }
    return chapters;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select(".page-image").map((it, i) => new Page(i, "", it.absUrl("src")));
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Ignored if using text search"), new Filters());
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new CheckBoxPreference();
    p.key = HIDE_VIP_PREF;
    p.title = "Hide VIP chapters";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }
}
