// Port of keiyoushi/extensions-source src/en/rinkocomics/RinkoComics.kt
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
  SwitchPreferenceCompat,
  ifBlank,
  isBlank,
  parseHtml,
  toHttpUrl,
  toJsonElement,
  urlWithoutDomain,
  type Element,
  type HttpUrlBuilder,
  type PreferenceScreen,
} from "../../../sdk/index.ts";

// "[MMMM][MMM] d, yyyy": the SDK's MMMM already takes full and abbreviated month names (no optional sections)
const dateFormat = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH);

const PREF_HIDE_LOCKED = "hide_paid_chapters";
const SORT_PARAM = "sort";
const LOCK_PREFIX = "🔒 ";
const LOCK_SUFFIX = "#lock";
const CHAPTER_SELECTOR = "li.chapter";
const CHAPTERS_PER_PAGE = 10;
const NONCE_REGEX = /comicworld_ajax\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/;

class Genre extends Filter.CheckBox {
  constructor(
    name: string,
    readonly slug: string,
  ) {
    super(name);
  }
}

class GenreFilter extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genres", genres);
  }
}

const SORT_OPTIONS: [string, string][] = [
  ["Newest First", "newest"],
  ["Oldest First", "oldest"],
  ["A-Z", "az"],
  ["Z-A", "za"],
];

class SortFilter extends Filter.Select<string> {
  constructor() {
    super(
      "Sort",
      SORT_OPTIONS.map((it) => it[0]),
    );
  }
  toQuery(): string | null {
    return SORT_OPTIONS[this.state]?.[1] ?? null;
  }
}

interface AjaxResponse {
  success?: boolean;
  data?: { html?: string | null } | null;
}

export default class RinkoComics extends KeiSource {
  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(this.baseUrl)).asJsoup();

    const entries: SManga[] = [];
    for (const card of document.select(".comics-flex-pinned a.pinned-comic-card")) {
      const url = card.attr("abs:href").trim();
      if (isBlank(url)) continue;
      const title = card.selectFirst(".pinned-comic-title")?.text().trim();
      if (title == null) continue;

      const manga = SManga.create();
      manga.url = urlWithoutDomain(url);
      manga.title = title;
      const img = card.selectFirst(".comic-thumbnail img");
      manga.thumbnail_url = (img ? this.imageFromElement(img) : null) ?? undefined;
      entries.push(manga);
    }

    return new MangasPage(entries, false);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.comicsUrl(page).addQueryParameter(SORT_PARAM, SORT_OPTIONS[0][1]).build();

    return this.parseComicsPage((await this.client.get(url.toString())).asJsoup());
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = this.comicsUrl(page).addQueryParameter("post_type", "comic");

    if (!isBlank(query)) url.addQueryParameter("s", query);

    for (const filter of filters) {
      if (filter instanceof GenreFilter) {
        filter.state.filter((it) => it.state).forEach((it) => url.addQueryParameter("genres[]", it.slug));
      } else if (filter instanceof SortFilter) {
        const q = filter.toQuery();
        if (q != null) url.addQueryParameter(SORT_PARAM, q);
      }
    }

    return this.parseComicsPage((await this.client.get(url.build().toString())).asJsoup());
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    const updatedManga = this.parseMangaDetails(document);
    updatedManga.url = manga.url;

    if (!fetchChapters) return new SMangaUpdate(updatedManga, chapters);

    return new SMangaUpdate(updatedManga, await this.parseChapterList(document));
  }

  private parseMangaDetails(document: Element): SManga {
    const manga = SManga.create();
    manga.title = this.requireField(document.selectFirst(".comic-info-upper h1")?.text() ?? document.selectFirst("h1")?.text(), "title");

    manga.thumbnail_url = document.selectFirst("meta[property=og:image]")?.attr("content");

    const authors = [
      ...new Set(
        document
          .select(".comic-graph > span")
          .map((it) => it.text())
          .filter((it) => !isBlank(it) && it !== "•"),
      ),
    ];

    manga.author = authors[0];
    manga.artist = authors[1];

    manga.status = this.parseStatus(document.selectFirst(".comic-status span:last-child")?.text());

    manga.genre = document
      .select(".comic-genres .genres .genre")
      .map((it) => it.text())
      .join(", ");

    manga.description = document.selectFirst(".comic-synopsis")?.text().trim();
    return manga;
  }

  private async parseChapterList(document: Element): Promise<SChapter[]> {
    const hideLocked = this.preferences.getBoolean(PREF_HIDE_LOCKED, false);

    const chapters = new Map<string, SChapter>();
    const addAll = (items: SChapter[]) => {
      for (const chapter of items) if (!chapters.has(chapter.url)) chapters.set(chapter.url, chapter);
    };

    addAll(this.parseChapterElements([...document.select(CHAPTER_SELECTOR)], hideLocked));

    const loadMoreBtn = document.selectFirst("#loadMoreChaptersBtn");
    const comicId = loadMoreBtn?.attr("data-comic-id") ?? "";
    const nonce = this.extractNonce(document) ?? "";
    const offsetAttr = loadMoreBtn?.attr("data-offset");
    let offset = offsetAttr != null && /^[+-]?\d+$/.test(offsetAttr) ? Number.parseInt(offsetAttr, 10) : 0;
    if (offset <= 0) offset = chapters.size;
    else if (chapters.size > 0 && offset > chapters.size) offset = chapters.size;

    if (!isBlank(comicId) && !isBlank(nonce)) {
      for (;;) {
        const items = await this.fetchMoreChapters(comicId, offset, nonce, hideLocked);
        if (items.length === 0) break;
        addAll(items);
        offset += CHAPTERS_PER_PAGE;
      }
    }

    return [...chapters.values()];
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    if (chapter.url.includes(LOCK_SUFFIX)) throw new Error("This chapter is locked. Use WebView to purchase it.");

    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const pages: Page[] = [];
    document.select("img.chapter-image").forEach((element, index) => {
      const imageUrl = ifBlank(element.attr("abs:data-src"), element.attr("abs:src")).trim();
      if (isBlank(imageUrl)) return;
      pages.push(new Page(index, "", imageUrl));
    });

    if (pages.length === 0) throw new Error("Chapter is locked or unavailable.");

    return pages;
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(this.comicsUrl(1).build().toString())).asJsoup();

    const genres: { first: string; second: string }[] = [];
    for (const input of document.select(".ac-filter-group.ac-genre input[name='genres[]']")) {
      const slug = input.attr("value").trim();
      const name = input.parent()?.selectFirst(".ac-option-text")?.text().trim() ?? "";
      if (!isBlank(slug) && !isBlank(name)) genres.push({ first: name, second: slug });
    }
    return toJsonElement(genres);
  }

  override getFilterList(data: unknown = null): FilterList {
    const filters: Filter[] = [];

    const genres = data as { first: string; second: string }[] | null;
    if (genres) filters.push(new GenreFilter(genres.map((it) => new Genre(it.first, it.second))));

    filters.push(new SortFilter());

    return FilterList(...filters);
  }

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = PREF_HIDE_LOCKED;
    p.title = "Hide paid chapters";
    p.summary = "Hide locked/paid chapters from the list.";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }

  private comicsUrl(page: number): HttpUrlBuilder {
    const url = page <= 1 ? `${this.baseUrl}/comic/` : `${this.baseUrl}/comic/page/${page}/`;
    return toHttpUrl(url).newBuilder();
  }

  private parseComicsPage(document: Element): MangasPage {
    const entries: SManga[] = [];
    for (const card of document.select("article.ac-card")) {
      const url = card.selectFirst(".ac-title a")?.attr("abs:href").trim() ?? "";
      if (isBlank(url)) continue;
      const title = this.requireField(card.selectFirst(".ac-title a")?.text(), "title");

      const manga = SManga.create();
      manga.url = urlWithoutDomain(url);
      manga.title = title;
      const img = card.selectFirst(".ac-thumb img");
      manga.thumbnail_url = (img ? this.imageFromElement(img) : null) ?? undefined;
      entries.push(manga);
    }

    const hasNextPage = document.selectFirst(".ac-pagination a.next") != null;

    return new MangasPage(entries, hasNextPage);
  }

  private parseChapterElements(elements: Element[], hideLocked: boolean): SChapter[] {
    const result: SChapter[] = [];
    for (const element of elements) {
      const permalink = element.attr("data-permalink").trim();
      const href = element.selectFirst("a")?.attr("abs:href") ?? "";
      const url = ifBlank(permalink, href);
      if (isBlank(url)) continue;

      const name = element.selectFirst(".chapter-number")?.text() ?? element.attr("data-title");
      const dateText = element.selectFirst(".chapter-date")?.text();
      const locked = this.isLocked(element);

      if (locked && hideLocked) continue;

      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(url);
      chapter.name = name?.trim() ?? "";
      chapter.date_upload = dateFormat.tryParseDate(dateText);

      if (locked) {
        chapter.name = `${LOCK_PREFIX}${chapter.name}`;
        chapter.url += LOCK_SUFFIX;
      }
      result.push(chapter);
    }
    return result;
  }

  private isLocked(element: Element): boolean {
    const reason = element.attr("data-reason").toLowerCase();
    if (!isBlank(reason) && reason !== "free") return true;
    if (element.hasClass("locked-chapter")) return true;

    const href = element.selectFirst("a")?.attr("href") ?? "";
    if (isBlank(href) || href === "#") return true;

    return element.selectFirst(".chapter_price") != null;
  }

  private async fetchMoreChapters(comicId: string, offset: number, nonce: string, hideLocked: boolean): Promise<SChapter[]> {
    const formBody = new URLSearchParams();
    formBody.append("action", "load_more_chapters");
    formBody.append("nonce", nonce);
    formBody.append("comic_id", comicId);
    formBody.append("offset", String(offset));

    const xhrHeaders = this.headers;
    xhrHeaders.append("X-Requested-With", "XMLHttpRequest");
    const result = (await this.client.post(`${this.baseUrl}/wp-admin/admin-ajax.php`, xhrHeaders, formBody)).parseAs<AjaxResponse>();
    if (!result.success) return [];

    const html = result.data?.html ?? "";
    if (isBlank(html)) return [];

    const doc = parseHtml(this.host.load, html, "");
    return this.parseChapterElements([...doc.select(CHAPTER_SELECTOR)], hideLocked);
  }

  private extractNonce(document: Element): string | null {
    const match = NONCE_REGEX.exec(document.html());
    return match ? match[1] : null;
  }

  private parseStatus(status: string | null | undefined): number {
    switch (status?.trim().toLowerCase()) {
      case "ongoing":
        return SManga.ONGOING;
      case "completed":
        return SManga.COMPLETED;
      case "hiatus":
        return SManga.UNKNOWN;
      case "cancelled":
      case "canceled":
        return SManga.CANCELLED;
      default:
        return SManga.UNKNOWN;
    }
  }

  private imageFromElement(element: Element): string | null {
    const imageUrl = element.hasAttr("data-src") ? element.attr("abs:data-src") : element.hasAttr("data-lazy-src") ? element.attr("abs:data-lazy-src") : element.attr("abs:src");
    return imageUrl.trim() || null;
  }

  private requireField(value: string | null | undefined, label: string): string {
    const trimmed = value?.trim();
    if (isBlank(trimmed)) throw new Error(`Missing ${label}`);
    return trimmed;
  }
}
