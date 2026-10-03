// Port of keiyoushi/extensions-source lib-multisrc/manga18/Manga18.kt
import {
  Base64,
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
  fromUtf8,
  substringAfter,
  substringAfterLast,
  substringBefore,
  toHttpUrl,
  toJsonElement,
  urlWithoutDomain,
  type Document,
  type Element,
} from "../../sdk/index.ts";
import { SortFilter, TagFilter, type Pair } from "./filters.ts";

export abstract class Manga18 extends KeiSource {
  override async getPopularManga(page: number): Promise<MangasPage> {
    return this.popularMangaParse((await this.client.get(`${this.baseUrl}/list-manga/${page}?order_by=views`)).asJsoup());
  }

  protected popularMangaParse(document: Document): MangasPage {
    const entries = document.select(this.popularMangaSelector()).map((it) => this.popularMangaFromElement(it));
    const hasNextPage = document.selectFirst(this.popularMangaNextPageSelector()) != null;

    return new MangasPage(entries, hasNextPage);
  }

  protected popularMangaSelector() {
    return "div.story_item";
  }
  protected popularMangaNextPageSelector() {
    return ".pagination > li:last-child:not(.active)";
  }

  protected popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
    manga.title = element.selectFirst("div.mg_info > div.mg_name a")!.text();
    manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
    return manga;
  }

  override async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.popularMangaParse((await this.client.get(`${this.baseUrl}/list-manga/${page}`)).asJsoup());
  }

  override async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const builder = toHttpUrl(this.baseUrl).newBuilder();
    const tag = filters.find((f): f is TagFilter => f instanceof TagFilter);
    if (query.length > 0 || !tag?.selected) {
      builder.addPathSegment("list-manga");
      builder.addPathSegment(String(page));
      builder.addQueryParameter("search", query.trim());
    } else {
      builder.addPathSegment("manga-list");
      builder.addPathSegment(tag.selected);
      builder.addPathSegment(String(page));
      const sort = filters.find((f): f is SortFilter => f instanceof SortFilter)?.selected;
      if (sort != null) builder.addQueryParameter("order_by", sort);
    }
    const url = builder.build();

    return this.popularMangaParse((await this.client.get(url.toString())).asJsoup());
  }

  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    if (url.host !== new URL(this.baseUrl).host || url.pathname.split("/")[1] !== "manhwa") return null;

    const manga = this.mangaDetailsParse((await this.client.get(url)).asJsoup());
    manga.url = urlWithoutDomain(url.href);
    return manga;
  }

  protected getAvailableTags = true;
  protected tagsSelector = "div.grid_cate li > a";

  override get supportsFilterFetching() {
    return this.getAvailableTags;
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/list-manga/1`)).asJsoup();
    const tags: Pair[] = document.select(this.tagsSelector).map((it) => {
      const href = it.attr("href");
      return { first: it.text(), second: substringAfterLast(href.endsWith("/") ? href.slice(0, -1) : href, "/") };
    });
    return toJsonElement([{ first: "", second: "" }, ...tags]);
  }

  override getFilterList(data: unknown = null): FilterList {
    const tags = data as Pair[] | null;
    if (tags == null) return FilterList();

    return FilterList(new Filter.Header("Ignored with text search"), new Filter.Separator(), new SortFilter(), new TagFilter(tags));
  }

  // Details and chapters come from the same page
  override async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    return new SMangaUpdate(
      this.mangaDetailsParse(document),
      document.select(this.chapterListSelector()).map((it) => this.chapterFromElement(it)),
    );
  }

  protected infoElementSelector = "div.detail_listInfo";
  protected titleSelector = "div.detail_name > h1";
  protected descriptionSelector = "div.detail_reviewContent";
  protected statusSelector = "div.item:contains(Status) div.info_value";
  protected altNameSelector = "div.item:contains(Other name) div.info_value";
  protected genreSelector = "div.info_value > a[href*='/manga-list/']";
  protected authorSelector = "div.info_label:contains(author) + div.info_value, div.info_label:contains(autor) + div.info_value";
  protected artistSelector = "div.info_label:contains(artist) + div.info_value";
  protected thumbnailSelector = "div.detail_avatar > img";

  protected mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    const info = document.selectFirst(this.infoElementSelector)!;

    manga.title = document.select(this.titleSelector).text();
    let description = "";
    for (const it of document.select(this.descriptionSelector).eachText()) description += `${it}\n\n`;
    const altName = info.selectFirst(this.altNameSelector)?.text();
    if (altName && altName !== "Updating") description += `Alternative Names:\n${altName}`;
    manga.description = description;
    switch (info.select(this.statusSelector).text()) {
      case "On Going":
        manga.status = SManga.ONGOING;
        break;
      case "Completed":
        manga.status = SManga.COMPLETED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }
    const author = info.selectFirst(this.authorSelector)?.text();
    manga.author = author !== "Updating" ? author : undefined;
    const artist = info.selectFirst(this.artistSelector)?.text();
    manga.artist = artist !== "Updating" ? artist : undefined;
    manga.genre = info.select(this.genreSelector).eachText().join(", ");
    manga.thumbnail_url = document.selectFirst(this.thumbnailSelector)?.absUrl("src");
    return manga;
  }

  protected chapterListSelector() {
    return "div.chapter_box .item";
  }

  protected dateFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("dd-MM-yyyy", Locale.ENGLISH);

  protected chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const a = element.selectFirst("a")!;
    chapter.url = urlWithoutDomain(a.absUrl("href"));
    chapter.name = a.text();
    chapter.date_upload = this.dateFormat.tryParseDate(element.selectFirst("p")?.text());
    return chapter;
  }

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    // script:containsData(slides_p_path)
    const script = document.select("script").find((it) => it.data().includes("slides_p_path"));
    if (!script) throw new Error("Unable to find script with image data");

    const encodedImages = substringBefore(substringAfter(script.data(), "["), ",]").replaceAll('"', "").split(",");

    return encodedImages.map((encoded, idx) => {
      const url = fromUtf8(Base64.decode(encoded));
      const imageUrl = url.startsWith("/") ? `${this.baseUrl}${url}` : url;
      return new Page(idx, "", imageUrl);
    });
  }
}
