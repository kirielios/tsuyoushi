// Port of keiyoushi/extensions-source src/en/mangamob/Comivex.kt (+ Filters.kt)
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, SwitchPreferenceCompat, distinctBy, firstInstanceOrNull, isBlank, toHttpUrl, urlWithoutDomain, type Element, type PreferenceScreen, type Response } from "../../../sdk/index.ts";
import { GenreFilter, SortFilter, StatusFilter, TypeFilter } from "./filters.ts";

const PREF_HIDE_STALE = "pref_hide_stale_explore_entries";

const RELATIVE_DATE_REGEX = /(\d+)\s+(year|month|week|day|hour|minute)s?/g;
const SERIES_ID_REGEX = /\/series\/(\d+)[-/]/;

// Pinned at the top of `sort_by=Updated` for months with no new chapters
// (upstream metadata-mtime bug). Numeric id is stable across slug renames.
const STALE_EXPLORE_IDS = new Set([
  "7805", // Even Though I'm a Level-0 Useless Explorer …
  "8025", // Saikyou Demodori Chuunen Boukensha Wa …
  "8168", // All-Class Awakening: God Slayer II
  "8169", // Toritsu Gyakujuuji Byouin
  "8176", // Fight Delivery
  "8188", // The Strongest Sage With Zero Magic Power …
]);

export default class Comivex extends KeiSource {
  private get hideStaleExploreEntries(): boolean {
    return this.preferences.getBoolean(PREF_HIDE_STALE, true);
  }

  // ============================== Popular ===============================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.exploreParse(await this.client.get(`${this.baseUrl}/explore/?sort_by=Views&results=${page}&ajax=1`));
  }

  // =============================== Latest ===============================
  // /latest/ orders by chapter publication; /explore/?sort_by=Updated
  // orders by metadata mtime and surfaces stale series.

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const cards = (await this.client.get(`${this.baseUrl}/latest/`)).asJsoup().select("article.u-card");
    const mangas = distinctBy(
      cards.map((c) => this.parseLatestCard(c)).filter((it): it is SManga => it !== null),
      (it) => it.url,
    );
    return new MangasPage(mangas, false);
  }

  private parseLatestCard(card: Element): SManga | null {
    const link = card.selectFirst("a.u-card__title");
    if (!link) return null;
    const name = [link.attr("title"), link.text()].find((it) => !isBlank(it));
    if (name === undefined) return null;
    const manga = SManga.create();
    manga.url = urlWithoutDomain(link.attr("abs:href"));
    manga.title = name;
    manga.thumbnail_url = card.selectFirst("img.u-card__img")?.attr("abs:src");
    return manga;
  }

  // =============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(`${this.baseUrl}/explore/`).newBuilder();
    if (query.length > 0) builder.addQueryParameter("search", query);

    // Site lists formats and content genres under one `genre_included`
    // param; Type wins when both are set.
    const typeValue = firstInstanceOrNull(filters, TypeFilter)?.selectedValue();
    const genreIncluded = typeValue ? typeValue : (firstInstanceOrNull(filters, GenreFilter)?.selectedValue() ?? "");

    builder.addQueryParameter("genre_included", genreIncluded);
    builder.addQueryParameter("sort_by", firstInstanceOrNull(filters, SortFilter)?.selectedValue() ?? "Views");
    builder.addQueryParameter("status", firstInstanceOrNull(filters, StatusFilter)?.selectedValue() ?? "");
    builder.addQueryParameter("results", String(page));
    builder.addQueryParameter("ajax", "1");

    return this.exploreParse(await this.client.get(builder.build().toString()));
  }

  getFilterList(_data: unknown = null): FilterList {
    return FilterList(new GenreFilter(), new SortFilter(), new StatusFilter(), new TypeFilter());
  }

  private exploreParse(response: Response): MangasPage {
    const applyStaleFilter = this.hideStaleExploreEntries && new URL(response.url).searchParams.get("sort_by") === "Updated";

    const mangas: SManga[] = [];
    for (const card of response.asJsoup().select("article.manga-card")) {
      const link = card.selectFirst("a.card-cover");
      if (!link) continue;
      const url = link.attr("abs:href");
      if (applyStaleFilter) {
        const id = SERIES_ID_REGEX.exec(url)?.[1];
        if (id !== undefined && STALE_EXPLORE_IDS.has(id)) continue;
      }
      const name = card.selectFirst(".card-title a")?.text();
      if (name === undefined) continue;
      const manga = SManga.create();
      manga.url = urlWithoutDomain(url);
      manga.title = name;
      manga.thumbnail_url = card.selectFirst("img")?.attr("abs:src");
      mangas.push(manga);
    }
    return new MangasPage(mangas, mangas.length > 0);
  }

  // =========================== Manga Details ============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const details = SManga.create();
    const title = document.selectFirst(".md-title")?.text();
    if (title === undefined) throw new Error("Title not found");
    details.title = title;
    details.author = document.selectFirst(".md-author span")?.text();
    details.description = document.selectFirst("#synopsis")?.text();
    details.genre = document.select(".md-genres a.md-genre-pill").map((it) => it.text()).join(", ");
    details.thumbnail_url = document.selectFirst(".md-cover-wrap img.md-cover")?.attr("abs:src");
    details.status = this.parseStatus(document.selectFirst(".md-status")?.text());

    const chapterList = document.select(".ch-list .ch-item").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.selectFirst("a.ch-link")!.attr("abs:href"));
      chapter.name = element.selectFirst(".ch-num")?.text() ?? "";
      chapter.date_upload = this.parseRelativeDate(element.selectFirst(".ch-date")?.text() ?? "");
      return chapter;
    });

    return new SMangaUpdate(details, chapterList);
  }

  private parseStatus(status: string | undefined): number {
    if (status === undefined) return SManga.UNKNOWN;
    const lower = status.toLowerCase();
    if (lower.includes("ongoing")) return SManga.ONGOING;
    if (lower.includes("completed")) return SManga.COMPLETED;
    if (lower.includes("hiatus")) return SManga.ON_HIATUS;
    return SManga.UNKNOWN;
  }

  // ============================== Chapters ==============================

  private parseRelativeDate(dateStr: string): number {
    const now = new Date();
    let matched = false;
    for (const match of dateStr.matchAll(RELATIVE_DATE_REGEX)) {
      matched = true;
      const amount = Number.parseInt(match[1], 10);
      switch (match[2]) {
        case "year":
          now.setFullYear(now.getFullYear() - amount);
          break;
        case "month":
          now.setMonth(now.getMonth() - amount);
          break;
        case "week":
          now.setDate(now.getDate() - amount * 7);
          break;
        case "day":
          now.setDate(now.getDate() - amount);
          break;
        case "hour":
          now.setHours(now.getHours() - amount);
          break;
        case "minute":
          now.setMinutes(now.getMinutes() - amount);
          break;
      }
    }
    return matched ? now.getTime() : 0;
  }

  // =============================== Pages ================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("#chapter-images .page-wrapper img").map((img, index) => new Page(index, "", img.attr("abs:src")));
  }

  // ============================ Preferences =============================

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = PREF_HIDE_STALE;
    p.title = "Hide stuck 'Recently Updated' entries";
    p.summary = "Skip manga that have been pinned to the top of Explore's 'Recently Updated' sort for months with no new chapters. The Latest tab is unaffected.";
    p.setDefaultValue(true);
    screen.addPreference(p);
  }
}
