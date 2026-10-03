// Port of keiyoushi/extensions-source src/all/hentai3/Hentai3.kt (+ Hentai3Filters.kt)
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
  parseHtml,
  toHttpUrl,
  urlWithoutDomain,
  type Document,
  type Response,
  type PreferenceScreen,
} from "../../../sdk/index.ts";

// Hentai3Filters.kt
class TextFilter extends Filter.Text {
  constructor(
    name: string,
    readonly type: string,
    readonly specific = "",
  ) {
    super(name);
  }
}

class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly vals: [string, string][],
    state = 0,
  ) {
    super(name, vals.map((it) => it[0]), state);
  }
  getValue() {
    return this.vals[this.state][1];
  }
}

const getSortsList: [string, string][] = [
  ["Recent", ""],
  ["Popular: All Time", "popular"],
  ["Popular: Week", "popular-7d"],
  ["Popular: Today", "popular-24h"],
];

const getFilters = (): FilterList =>
  FilterList(
    new SelectFilter("Sort by", getSortsList),
    new Filter.Separator(),
    new Filter.Header("Separate tags with commas (,)"),
    new Filter.Header("Prepend with dash (-) to exclude"),
    new Filter.Header("Use 'Male Tags' or 'Female Tags' for specific categories. 'Tags' searches all categories."),
    new TextFilter("Tags", "tags"),
    new TextFilter("Male Tags", "tags", "male"),
    new TextFilter("Female Tags", "tags", "female"),
    new TextFilter("Series", "series"),
    new TextFilter("Characters", "characters"),
    new TextFilter("Artists", "artist"),
    new TextFilter("Groups", "groups"),
    new TextFilter("Languages", "language"),
    new Filter.Separator(),
    new Filter.Header("Filter by pages, for example: (>20)"),
    new TextFilter("Pages", "page"),
  );

const SHORT_TITLE_REGEX = /(\[[^\]]*\]|[({][^)}]*[)}])/g;
const REMOVE_THUMB_REGEX = /t(?=\.)/g;
// SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZZZZZ", Locale.ROOT)
const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.ROOT);

const capitalizeEach = (s: string) => s.split(" ").map((w) => (w && w[0] !== w[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

export default class Hentai3 extends KeiSource {
  /**
   * Jsoup parses <noscript> content as elements (no scripting); cheerio's default treats it as text, which hides the
   * cover <img> the list selectors rely on ("img:not([class])" is the noscript fallback image).
   */
  private asJsoup(response: Response): Document {
    return parseHtml((html, options) => this.host.load(html, { ...options, scriptingEnabled: false }), response.text(), response.url);
  }

  private get searchLang(): string {
    switch (this.lang) {
      case "all": return "";
      case "en": return "english";
      case "ja": return "japanese";
      case "ko": return "korean";
      case "zh": return "chinese";
      case "mo": return "mongolian";
      case "es": return "spanish";
      case "pt": return "Portuguese";
      case "id": return "indonesian";
      case "jv": return "javanese";
      case "tl": return "tagalog";
      case "vi": return "vietnamese";
      case "th": return "thai";
      case "my": return "burmese";
      case "tr": return "turkish";
      case "ru": return "russian";
      case "uk": return "ukrainian";
      case "pl": return "polish";
      case "fi": return "finnish";
      case "de": return "german";
      case "it": return "italian";
      case "fr": return "french";
      case "nl": return "dutch";
      case "cs": return "czech";
      case "hu": return "hungarian";
      case "bg": return "bulgarian";
      case "is": return "icelandic";
      case "la": return "latin";
      case "ar": return "arabic";
      default: return "";
    }
  }

  // Popular + Latest
  async getPopularManga(page: number): Promise<MangasPage> {
    const url =
      this.searchLang.length > 0
        ? `${this.baseUrl}/language/${this.searchLang}/${page > 1 ? page : ""}?sort=popular`
        : `${this.baseUrl}/search?q=pages%3A>0&page=${page}&sort=popular`;
    const doc = this.asJsoup(await this.client.get(url));
    return this.parseMangasPage(doc);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const url = this.searchLang.length > 0 ? `${this.baseUrl}/language/${this.searchLang}/${page}` : `${this.baseUrl}/search?q=pages%3A>0&page=${page}`;
    const doc = this.asJsoup(await this.client.get(url));
    return this.parseMangasPage(doc);
  }

  private parseMangasPage(doc: Document): MangasPage {
    const mangas = doc.select("a[href*=/d/]").map((element) => {
      const manga = SManga.create();
      manga.title = this.shortenTitle(element.selectFirst("div.title")!.ownText());
      manga.url = urlWithoutDomain(element.absUrl("href"));
      manga.thumbnail_url = element.selectFirst("img:not([class])")!.absUrl("src");
      return manga;
    });
    const hasNextPage = doc.selectFirst("a[rel=next]") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Search
  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let sort = "";

    let tags = "";
    for (const filter of filters) {
      if (filter instanceof SelectFilter) {
        sort = filter.getValue();
      } else if (filter instanceof TextFilter) {
        filter.state
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .forEach((rawTag) => {
            const tag = rawTag.toLowerCase();

            if (tag.startsWith("-")) tags += "-";

            tags += filter.type;

            if (filter.type === "page") {
              tags += `:${tag}`;
            } else {
              tags += ":'";
              tags += tag.startsWith("-") ? tag.slice(1) : tag;

              if (filter.specific.length > 0) tags += ` (${filter.specific})`;
              tags += "' ";
            }
          });
      }
    }

    const language = this.searchLang.length > 0 ? `language:${this.searchLang}` : "";

    const builder = toHttpUrl(this.baseUrl).newBuilder();
    builder.addPathSegment("search");
    builder.addQueryParameter("q", `${query} ${language} ${tags}`);
    if (page > 1) builder.addQueryParameter("page", String(page));
    builder.addQueryParameter("sort", sort);

    return this.parseMangasPage(this.asJsoup(await this.client.get(builder.build().toString())));
  }

  getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  // Details + Chapters
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== toHttpUrl(this.baseUrl).host) return null;
    const segments = url.pathname.slice(1).split("/");
    if (segments[0] !== "d") return null;
    const id = segments[1];
    if (id === undefined) return null;
    return this.parseMangaDetails(this.asJsoup(await this.client.get(`${this.baseUrl}/d/${id}`)));
  }

  private parseMangaDetails(document: Document): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(document.location());

    const authors = document.select("a[href*=/groups/]").eachText().join(", ");
    const artists = document.select("a[href*=/artists/]").eachText().join(", ");
    manga.initialized = true;

    manga.title = this.shortenTitle(document.select("h1").text());
    manga.author = authors || artists;
    manga.artist = artists || authors;
    manga.genre = document
      .select("a[href*=/tags/]")
      .eachText()
      .map((it) => {
        const capitalized = capitalizeEach(it);
        return capitalized.includes("male") ? capitalized.replace("(female)", "♀").replace("(male)", "♂") : `${capitalized} ◊`;
      })
      .join(", ");

    let description = "";
    const part = (selector: string, label: string) => {
      const text = document.select(selector).eachText().join(", ");
      if (text) description += `${label}: ${capitalizeEach(text)}\n\n`;
    };
    part("a[href*=/characters/]", "Characters");
    part("a[href*=/series/]", "Series");
    part("a[href*=/groups/]", "Groups");
    part("a[href*=/language/]", "Languages");
    description += `${document.select("div.tag-container:contains(pages:)").text()}\n`;
    manga.description = description;

    const img = document.selectFirst("img")!;
    manga.thumbnail_url = img.attr("data-src") || img.absUrl("src");
    manga.status = SManga.COMPLETED;
    // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: no SManga field here
    return manga;
  }

  private parseChapterList(doc: Document): SChapter[] {
    const chapter = SChapter.create();
    chapter.name = "Chapter";
    chapter.url = urlWithoutDomain(doc.location());
    chapter.date_upload = dateFormat.tryParseZonedDateTime(doc.select("time").attr("datetime"));
    return [chapter];
  }

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const doc = this.asJsoup(await this.client.get(this.getMangaUrl(manga)));
    return new SMangaUpdate(this.parseMangaDetails(doc), this.parseChapterList(doc));
  }

  // Related manga
  override get supportsRelatedMangas(): boolean {
    return true;
  }

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const doc = this.asJsoup(await this.client.get(this.getMangaUrl(manga)));
    return doc.select("#similar-content .doujin-col .doujin a.cover").map((link) => {
      const m = SManga.create();
      m.title = link.selectFirst(".title")!.text();
      m.url = urlWithoutDomain(link.absUrl("href"));
      const img = link.selectFirst("img")!;
      m.thumbnail_url = img.attr("data-src") || img.absUrl("src");
      return m;
    });
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const doc = this.asJsoup(await this.client.get(this.getChapterUrl(chapter)));
    return doc.select("img:not([class], [src*=thumb], [src*=cover])").map((image, index) => {
      const imageUrl = image.absUrl("src");
      return new Page(index, "", imageUrl.replace(REMOVE_THUMB_REGEX, ""));
    });
  }

  // Preferences
  private shortenTitle(s: string): string {
    return this.displayFullTitle ? s : s.replace(SHORT_TITLE_REGEX, "").trim();
  }

  private get displayFullTitle(): boolean {
    return this.preferences.getBoolean("full_title", false);
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = "full_title";
    p.title = "Display full title";
    screen.addPreference(p);
  }
}
