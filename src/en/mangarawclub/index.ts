// Port of keiyoushi/extensions-source src/en/mangarawclub/MangaRawClub.kt
import {
  DateTimeFormatterBuilder,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  SwitchPreferenceCompat,
  parseAs,
  parseHtml,
  substringAfter,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Element,
  type FilterList,
  type PreferenceScreen,
} from "../../../sdk/index.ts";
import { ChapterMaxFilter, ChapterMinFilter, ExtraFilter, GenreFilter, RatingFilter, SortFilter, StatusFilter, TextFilter, TypeFilter, getFilters, isDefault } from "./filters.ts";

// Dto.kt
interface Dto {
  results_html: string;
  page: number;
  num_pages: number;
}

// Site uses AP style months ("Sept.", "March") and optional minutes ("3 p.m.")
const DATE_FORMATTER = new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern("[MMMM][MMM] d, yyyy, h[:mm] a").toFormatter(Locale.ENGLISH);

const ALT_NAME = "Alternative Names:";
const PREF_HIDE_NSFW = "pref_hide_nsfw";
const ALT_NAME_BULLET_SEMICOLON_REGEX = /[•;]/;
const ALT_NAME_COMMA_REGEX = /,/;

export default class MangaRawClub extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.connectTimeout(10_000).readTimeout(30_000);
  }

  private nsfw = () => this.preferences.getBoolean(PREF_HIDE_NSFW, false);

  // ============================== Popular ==============================
  getPopularManga(page: number): Promise<MangasPage> {
    return this.browseMangaList(`${this.baseUrl}/browse-comics/data/?page=${page}&sort=popular_all_time&safe_mode=${this.nsfw() ? "1" : "0"}`);
  }

  // ============================== Latest ===============================
  getLatestUpdates(page: number): Promise<MangasPage> {
    return this.browseMangaList(`${this.baseUrl}/browse-comics/data/?page=${page}&sort=latest&safe_mode=${this.nsfw() ? "1" : "0"}`);
  }

  // ============================== Search ===============================
  override getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    // Fallback directly to autocomplete query if only search term is provided
    if (query.trim() && filters.every((it) => isDefault(it))) {
      const url = toHttpUrl(`${this.baseUrl}/search/`).newBuilder().addQueryParameter("search", query.trim()).addQueryParameter("results", String(page)).build();

      const document = (await this.client.get(url.toString())).asJsoup();
      const mangas = document.select(".novel-item").map((element) => {
        const manga = SManga.create();
        manga.title = element.selectFirst(".novel-title")!.text();
        manga.thumbnail_url = this.coverUrl(element.selectFirst(".novel-cover img"));
        manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
        return manga;
      });
      const hasNextPage = document.selectFirst("nav.paging a:contains(Next)") != null;
      return new MangasPage(mangas, hasNextPage);
    }

    const builder = toHttpUrl(`${this.baseUrl}/browse-comics/data/`).newBuilder();
    const tagsIncl: string[] = [];
    const genreIncl: string[] = [];
    const genreExcl: string[] = [];

    for (const filter of filters) {
      if (filter instanceof SortFilter) {
        builder.addQueryParameter("sort", filter.selected);
      } else if (filter instanceof GenreFilter) {
        filter.state.forEach((it) => {
          if (it.isIncluded()) genreIncl.push(it.name);
          else if (it.isExcluded()) genreExcl.push(it.name);
        });
      } else if (filter instanceof StatusFilter) {
        builder.addQueryParameter("status", filter.selected);
      } else if (filter instanceof TypeFilter) {
        builder.addQueryParameter("type", filter.selected);
      } else if (filter instanceof ChapterMinFilter) {
        if (filter.state.length > 0) builder.addQueryParameter("min_chapters", filter.state.trim());
      } else if (filter instanceof ChapterMaxFilter) {
        if (filter.state.length > 0) builder.addQueryParameter("max_chapters", filter.state.trim());
      } else if (filter instanceof RatingFilter) {
        if (filter.state.length > 0) {
          const parsed = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(filter.state) ? Number(filter.state) : 0;
          builder.addQueryParameter("min_rating", String(Math.trunc(parsed * 10)));
        }
      } else if (filter instanceof TextFilter) {
        if (filter.state.length > 0) {
          filter.state
            .split(",")
            .filter((it) => it.length > 0)
            .forEach((tag) => tagsIncl.push(tag.trim()));
        }
      } else if (filter instanceof ExtraFilter) {
        filter.state.filter((it) => it.state).forEach((it) => builder.addQueryParameter(it.value, "1"));
      }
    }

    builder.addQueryParameter("safe_mode", this.nsfw() ? "1" : "0");
    builder.addQueryParameter("page", String(page));
    if (genreIncl.length > 0) builder.addQueryParameter("include_genres", genreIncl.join(","));
    if (genreExcl.length > 0) builder.addQueryParameter("exclude_genres", genreExcl.join(","));
    if (tagsIncl.length > 0) builder.addQueryParameter("tags", tagsIncl.join(","));
    builder.addQueryParameter("q", query);

    return this.browseMangaList(builder.build().toString());
  }

  private async browseMangaList(url: string): Promise<MangasPage> {
    const data = parseAs<Dto>((await this.client.get(toHttpUrl(url).toString())).text());
    // Jsoup.parseBodyFragment(html, baseUrl)
    const document = parseHtml(this.host.load, data.results_html, this.baseUrl);
    const mangas = document.select(".comic-card").map((it) => this.searchMangaFromElement(it));

    return new MangasPage(mangas, data.page < data.num_pages);
  }

  private coverUrl(img: Element | null): string | undefined {
    if (!img) return undefined;
    const dataSrc = img.absUrl("data-src");
    return dataSrc.length > 0 ? dataSrc : img.absUrl("src");
  }

  private searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.title = element.selectFirst(".comic-card__title a")!.text();
    manga.thumbnail_url = this.coverUrl(element.selectFirst(".comic-card__cover img"));
    manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
    return manga;
  }

  // ============================== Details ==============================
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const [details, chapterList] = await Promise.all([fetchDetails ? this.fetchMangaDetails(manga) : null, fetchChapters ? this.fetchChapterList(manga) : null]);

    return new SMangaUpdate(details ?? manga, chapterList ?? chapters);
  }

  private async fetchMangaDetails(manga: SManga): Promise<SManga> {
    const result = SManga.create();
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    if (!document.selectFirst(".novel-header")) throw new Error("Page not found");

    result.url = manga.url;
    result.title = manga.title;
    const author = document.selectFirst(".author a")?.attr("title").trim();
    result.author = author !== undefined && author.toLowerCase() !== "updating" ? author : undefined;

    let description = "";
    const summary = document.selectFirst(".description")?.text();
    if (summary !== undefined) description += substringAfter(summary, "Summary is");

    const altNames = this.parseAltNames(document.selectFirst(".alternative-title")?.ownText());
    if (altNames) {
      if (description.length > 0) description += "\n\n";
      description += ALT_NAME;
      altNames.forEach((name) => (description += `\n- ${name}`));
    }
    result.description = description;

    result.genre = document
      .select(".categories a[href*=genre]")
      .map((it) =>
        it
          .ownText()
          .split(" ")
          .map((word) => {
            const w = word.toLowerCase();
            return w.charAt(0).toUpperCase() + w.slice(1);
          })
          .join(" "),
      )
      .join(", ");

    if (document.selectFirst("div.header-stats strong.completed") != null) result.status = SManga.COMPLETED;
    else if (document.selectFirst("div.header-stats strong.ongoing") != null) result.status = SManga.ONGOING;
    else result.status = SManga.UNKNOWN;

    result.thumbnail_url = this.coverUrl(document.selectFirst(".cover img"));
    return result;
  }

  private parseAltNames(raw: string | null | undefined): string[] | null {
    if (!raw) return null;

    const separator = ALT_NAME_BULLET_SEMICOLON_REGEX.test(raw) ? ALT_NAME_BULLET_SEMICOLON_REGEX : ALT_NAME_COMMA_REGEX;

    const names = raw
      .split(separator)
      .map((it) => it.trim())
      .filter((it) => it.length > 0 && it.toLowerCase() !== "updating");
    return names.length > 0 ? names : null;
  }

  // ============================= Chapters ==============================
  private async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const document = (await this.client.get(`${this.baseUrl}${manga.url}all-chapters/`)).asJsoup();
    return document.select("ul.chapter-list > li").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));

      const chapterName = element.selectFirst(".chapter-title, .chapter-number")!.ownText().replace(/-eng-li$/, "");
      chapter.name = `Chapter ${chapterName}`;

      chapter.date_upload = this.parseChapterDate(element.selectFirst(".chapter-update")?.attr("datetime"));
      return chapter;
    });
  }

  private parseChapterDate(string: string | null | undefined): number {
    if (!string) return 0;
    const date = string.replaceAll(".", "").replaceAll("Sept", "Sep");
    return DATE_FORMATTER.tryParseDateTime(date);
  }

  // =============================== Pages ===============================
  async getPageList(chapter: SChapter) {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document
      .select("#chapter-reader img")
      .filter((it) => !it.absUrl("src").includes("credits-mgeko.png"))
      .map((img, i) => new Page(i, "", img.absUrl("src")));
  }

  // ============================= Utilities =============================
  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = PREF_HIDE_NSFW;
    p.title = "Hide NSFW";
    p.summary = "Hides NSFW entries";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }
}
