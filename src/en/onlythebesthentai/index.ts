// Port of keiyoushi/extensions-source src/en/onlythebesthentai/OnlyTheBestHentai.kt
import {
  Filter,
  FilterList,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  isBlank,
  toHttpUrl,
  tryParseInstant,
  urlWithoutDomain,
  type ChainInterceptor,
  type ClientBuilder,
  type Document,
  type Element,
} from "../../../sdk/index.ts";

const TITLE_CLEANUP_REGEX = /\s*\[\d+]\s*$/;
const NON_DIGIT_REGEX = /[^0-9]/g;
const WHITESPACE_REGEX = /\s+/;

// ============================== Filters ==================================

interface FilterEntry {
  name: string;
  slug: string;
  count: number;
}
const entryToString = (e: FilterEntry) => `${e.name} (${e.count})`;

interface FilterData {
  tags: FilterEntry[];
  parodies: FilterEntry[];
  characters: FilterEntry[];
  artists: FilterEntry[];
}

class TaxonomyFilter extends Filter.Select<string> {
  constructor(
    name: string,
    readonly path: string,
    private readonly entries: FilterEntry[],
  ) {
    super(name, ["Any", ...entries.map(entryToString)]);
  }
  get selectedSlug(): string | undefined {
    return this.entries[this.state - 1]?.slug;
  }
}

/** String.toIntOrNull() */
const toIntOrNull = (s: string | null | undefined) => (s != null && /^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : null);

const challengeInterceptor: ChainInterceptor = async (chain) => {
  const response = await chain.proceed(chain.request());
  const peek = new TextDecoder().decode(response.bytes().slice(0, 512));
  if (peek.includes("One moment, please") || peek.includes("wsidchk")) {
    throw new Error("Bot protection detected. Open this source in WebView to solve the challenge, then return to Mihon.");
  }
  return response;
};

export default class OnlyTheBestHentai extends KeiSource {
  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(challengeInterceptor);
  }

  // ============================= Popular / Latest ===========================

  getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangaList(`${this.baseUrl}/${page > 1 ? `page/${page}/` : ""}`);
  }

  override get supportsLatest() {
    return false;
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  private async parseMangaList(url: string): Promise<MangasPage> {
    const doc = (await this.client.get(url)).asJsoup();
    const mangas = doc.select("article.post").map((el) => this.elementToManga(el));
    return new MangasPage(mangas, doc.selectFirst("a.next.page-numbers") != null);
  }

  private elementToManga(el: Element): SManga {
    const manga = SManga.create();
    const a = el.selectFirst(".blog-entry-title a, .entry-title a")!;
    manga.url = urlWithoutDomain(a.absUrl("href"));
    manga.title = a.text().replace(TITLE_CLEANUP_REGEX, "").trim();
    manga.thumbnail_url = el.selectFirst(".nv-post-thumbnail-wrap img")?.attr("abs:src");
    return manga;
  }

  // =============================== Search ==================================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    if (!isBlank(query)) {
      const url = toHttpUrl(this.baseUrl).newBuilder().addQueryParameter("s", query);
      if (page > 1) url.addQueryParameter("paged", String(page));
      return this.parseMangaList(url.build().toString());
    }

    let filterUrl = `${this.baseUrl}/`;
    for (const filter of filters) {
      if (!(filter instanceof TaxonomyFilter)) continue;
      const slug = filter.selectedSlug;
      if (slug != null) {
        filterUrl = `${this.baseUrl}/${filter.path}/${slug}/`;
        break;
      }
    }

    return this.parseMangaList(`${filterUrl}${page > 1 ? `page/${page}/` : ""}`);
  }

  // ======================== Manga Details / Chapters ========================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const doc = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const details = SManga.create();
    details.title = doc.selectFirst("h1.manga-title")!.text();
    details.thumbnail_url = doc.selectFirst(".manga-box .manga-img img")?.attr("abs:src");
    details.genre = doc
      .select(".manga-tags-container:has(.manga-tags-label:containsOwn(Tags)) .tag-button")
      .map((el) => el.text())
      .join(", ");
    details.author = doc
      .select(".manga-tags-container:has(.manga-tags-label:containsOwn(Artist)) .tag-button")
      .map((el) => el.text())
      .join(", ");
    details.description = this.buildDescription(doc);
    details.status = SManga.COMPLETED;

    let pageCount: number | null = null;
    for (const container of doc.select(".manga-tags-container")) {
      const label = container.selectFirst(".manga-tags-label")?.text();
      if (label == null) continue;
      if (!label.startsWith("Pages")) continue;
      const n = toIntOrNull(container.text().replace(NON_DIGIT_REGEX, ""));
      if (n != null) {
        pageCount = n;
        break;
      }
    }

    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(doc.location());
    chapter.name = pageCount != null ? `Chapter [${pageCount} pages]` : "Chapter";
    chapter.chapter_number = 1;
    chapter.date_upload = tryParseInstant(doc.selectFirst("meta[property=article:published_time]")?.attr("content"));

    return new SMangaUpdate(details, [chapter]);
  }

  private buildDescription(doc: Document): string {
    let sb = "";
    const parodies = doc.select(".manga-tags-container:has(.manga-tags-label:containsOwn(Parody)) .tag-button").map((el) => el.text());
    if (parodies.length > 0) sb += `Parody: ${parodies.join(", ")}\n`;

    const characters = doc.select(".manga-tags-container:has(.manga-tags-label:containsOwn(Characters)) .tag-button").map((el) => el.text());
    if (characters.length > 0) sb += `Characters: ${characters.join(", ")}\n`;

    const pages = doc
      .select(".manga-tags-container:has(.manga-tags-label:containsOwn(Pages))")
      .first()
      ?.text()
      .replace(NON_DIGIT_REGEX, "");
    if (pages) sb += `Pages: ${pages}\n`;

    const rawBody = doc.selectFirst(".manga-info p")?.text();
    const body = rawBody?.replace(/^Description:/, "").trim();
    if (body) {
      if (sb.length > 0) sb += "\n";
      sb += body;
    }
    return sb.trim();
  }

  // ============================== Page List ================================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    return (await this.client.get(this.getChapterUrl(chapter)))
      .asJsoup()
      .select(".manga-gallery-wrapper figure.wp-block-image img")
      .map((img, i) => new Page(i, "", this.bestImageUrl(img)));
  }

  private bestImageUrl(img: Element): string {
    const srcset = img.attr("srcset");
    if (!isBlank(srcset)) {
      // maxByOrNull: the first entry with the highest width
      let best: string | undefined;
      let bestWidth = -1;
      for (const entry of srcset.split(",").map((it) => it.trim())) {
        const width = toIntOrNull(entry.split(WHITESPACE_REGEX).at(-1)?.replace(/w$/, "")) ?? 0;
        if (width > bestWidth) {
          best = entry;
          bestWidth = width;
        }
      }
      const url = best?.split(WHITESPACE_REGEX)[0];
      if (!isBlank(url)) return url;
    }
    return img.attr("abs:src");
  }

  // ============================== Filters ==================================

  private async fetchTaxonomy(restPath: string): Promise<FilterEntry[]> {
    const result: FilterEntry[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await this.client.get(`${this.baseUrl}/wp-json/wp/v2/${restPath}?per_page=100&page=${page}`);
      if (page === 1) totalPages = toIntOrNull(response.header("X-WP-TotalPages")) ?? 1;
      result.push(...response.parseAs<{ name: string; slug: string; count?: number }[]>().map((it) => ({ name: it.name, slug: it.slug, count: it.count ?? 0 })));
      page++;
    } while (page <= totalPages);

    const key = (e: FilterEntry) => e.name.toLowerCase();
    return result.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }

  override get supportsFilterFetching() {
    return true;
  }

  override async fetchFilterData(): Promise<FilterData> {
    return {
      tags: await this.fetchTaxonomy("tags"),
      parodies: await this.fetchTaxonomy("categories"),
      characters: await this.fetchTaxonomy("characters"),
      artists: await this.fetchTaxonomy("artist"),
    };
  }

  override getFilterList(data: unknown = null): FilterList {
    const filterData = data as FilterData | null;
    if (!filterData) return FilterList();

    return FilterList(
      new Filter.Header("Only one filter applies at a time (first selected wins)"),
      new TaxonomyFilter("Tag", "tag", filterData.tags),
      new TaxonomyFilter("Parody", "parody", filterData.parodies),
      new TaxonomyFilter("Character", "characters", filterData.characters),
      new TaxonomyFilter("Artist", "artist", filterData.artists),
    );
  }
}
