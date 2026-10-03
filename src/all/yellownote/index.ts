// Port of keiyoushi/extensions-source src/all/yellownote/YellowNote.kt
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  ListPreference,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  firstInstance,
  isBlank,
  toHttpUrl,
  urlWithoutDomain,
  type ClientBuilder,
  type Element,
  type PreferenceScreen,
  type Response,
} from "../../../sdk/index.ts";
import { Intl } from "../../../libs/i18n/index.ts";
import { CategorySelector, Filters, SortSelector } from "./filters.ts";
import { messages } from "./messages.ts";

export default class YellowNote extends KeiSource {
  // img.xchina.io blocks requests that do not look like browser image loads
  protected override configureClient(builder: ClientBuilder) {
    return builder.addInterceptor((request) => {
      if (new URL(request.url).host === toHttpUrl(this.baseUrl).host) return request;
      const headers = new Headers(request.headers);
      headers.set("Accept", "image/avif,image/webp,image/png,image/jpeg,*/*");
      return { ...request, headers };
    });
  }

  private _intl?: Intl;
  private get intl(): Intl {
    return (this._intl ??= new Intl({ language: this.lang, baseLanguage: "en", availableLanguages: ["en", "es", "ko", "zh-Hans", "zh-Hant"], messages }));
  }

  private dateFormat = DateTimeFormatter.ofPattern("yyyy.MM.dd");

  private dateRegex = /\d{4}\.\d{2}\.\d{2}/;
  private styleUrlRegex = /background-image\s*:\s*url\('([^']+)'\)/;
  private mediaCountRegex = /^(\d+P( \+ \d+V)?)$/;

  private mangaSelector = "div.list.photo-list > div.item.photo, div.list.amateur-list > div.item.amateur";
  private nextPageSelector = "div.pager a.next";
  private imageSelector = "div.list.photo-items > div.item.photo-image, div.list.amateur-items > div.item.amateur-image";

  // ============================== Preferences ==========================

  override setupPreferenceScreen(screen: PreferenceScreen) {
    const p = new ListPreference(screen.context);
    p.key = "XChina::IMAGE_QUALITY";
    p.title = this.intl.get("config.image_quality.title");
    p.summary = this.intl.get("config.image_quality.summary");
    p.entries = ["原图(JPG)", "高清(WebP)"];
    p.entryValues = ["original", "webp_hd"];
    p.setDefaultValue("original");
    screen.addPreference(p);
  }

  // ============================== Popular ==============================

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangaList(await this.client.get(`${this.baseUrl}/photos/sort-hot/${page}.html`));
  }

  // ============================== Latest ===============================

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseMangaList(await this.client.get(`${this.baseUrl}/photos/${page}.html`));
  }

  // ============================== Search ===============================

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const categorySelector = firstInstance(filters, CategorySelector);
    const sortSelector = firstInstance(filters, SortSelector);
    const uriPart = isBlank(query) ? categorySelector.toUriPart() : `photos/keyword-${query}`;

    const b = toHttpUrl(this.baseUrl).newBuilder();
    b.addPathSegments(uriPart);

    const sortPart = sortSelector.toUriPart();
    if (!isBlank(sortPart)) b.addPathSegment(sortPart);

    b.addPathSegment(`${page}.html`);

    return this.parseMangaList(await this.client.get(b.build().toString()));
  }

  // ============================== Details ==============================

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.getMangaUrl(manga));
    const basePageUrl = response.url.replace(/\.html$/, "");
    const document = response.asJsoup();

    return new SMangaUpdate(this.mangaDetailsParse(manga, document), this.chapterListParse(document, basePageUrl));
  }

  private mangaDetailsParse(manga: SManga, document: Element): SManga {
    const infoCardElement = document.selectFirst("div.info-card.photo-detail");
    if (!infoCardElement) throw new Error("Could not find info card");

    const name = this.parseInfoByIcon(infoCardElement, "i.fa-address-card");
    if (name == null) throw new Error("Could not find name");

    const mediaCount = this.parseInfoByIcon(infoCardElement, "i.fa-image");
    if (mediaCount == null) throw new Error("Could not find media count");

    const noText = this.parseInfoByIcon(infoCardElement, "i.fa-file");
    const no = noText != null ? ` ${noText}` : "";
    const categories = this.parseInfosByIcon(infoCardElement, "i.fa-video-camera")?.filter((it) => it !== "-");
    const filters = this.parseInfosByIcon(infoCardElement, "i.fa-filter");
    const tags = this.parseInfosByIcon(infoCardElement, "i.fa-tags");

    manga.title = `${name}${no}(${mediaCount})`;
    manga.author = infoCardElement.selectFirst("div.item.floating")?.text() ?? this.parseInfoByIcon(infoCardElement, "i.fa-circle-user") ?? undefined;

    const genres = [categories, filters, tags].filter((it) => it != null).flat();
    manga.genre = genres.length ? genres.join(", ") : undefined;
    manga.status = SManga.COMPLETED;
    // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
    return manga;
  }

  // ============================= Chapters ==============================

  private chapterListParse(doc: Element, basePageUrl: string): SChapter[] {
    const infoCardElement = doc.selectFirst("div.info-card.photo-detail")!;
    const uploadText = this.parseInfoByIcon(infoCardElement, "i.fa-calendar-days");
    const uploadAt = (uploadText != null ? this.dateFormat.tryParseDate(uploadText) : null) ?? this.parseUploadDateFromVersionInfo(doc) ?? 0;
    const lastPager = doc.select("div.pager:first-of-type a.pager-num").last()?.text();
    const parsed = lastPager != null && /^[+-]?\d+$/.test(lastPager) ? Number.parseInt(lastPager, 10) : null;
    const maxPage = parsed ?? 1;

    const chapters: SChapter[] = [];
    for (let page = maxPage; page >= 1; page--) {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(`${basePageUrl}/${page}.html`);
      chapter.name = `Page ${page}`;
      chapter.date_upload = uploadAt;
      chapters.push(chapter);
    }
    return chapters;
  }

  // =============================== Pages ===============================

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const quality = this.preferences.getString("XChina::IMAGE_QUALITY", "original") ?? "original";

    const pages: Page[] = [];
    document.select(this.imageSelector).forEach((imageElement, i) => {
      const url = this.parseUrlFormStyle(imageElement.selectFirst("div.img"));
      if (url == null) return;

      // PR #15991: Replace WebP with JPG for original quality
      const finalUrl = quality === "original" && url.includes("_600x0.webp") ? url.replaceAll("_600x0.webp", ".jpg") : url;

      pages.push(new Page(i, "", finalUrl));
    });
    return pages;
  }

  // ============================== Filters ==============================

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(Filters.createSortSelector(this.intl), new Filter.Separator(), new Filter.Header(this.intl.get("filter.header.ignored-when-search")), Filters.createCategorySelector(this.intl));
  }

  // ============================= Utilities =============================

  private parseMangaList(response: Response): MangasPage {
    const document = response.asJsoup();

    const mangas: SManga[] = [];
    for (const element of document.select(this.mangaSelector)) {
      const mangaEl = element.selectFirst("a");
      if (!mangaEl) continue;
      const mangaUrl = mangaEl.absUrl("href");
      if (isBlank(mangaUrl)) continue;
      const mangaTitle = mangaEl.attr("title");
      if (isBlank(mangaTitle)) continue;

      const manga = SManga.create();
      manga.url = urlWithoutDomain(mangaUrl);

      const count = element
        .select("div.tags > div")
        .map((it) => it.text())
        .find((it) => this.mediaCountRegex.test(it));
      const formatMediaCount = count != null ? `(${count})` : "";
      manga.title = `${mangaTitle}${formatMediaCount}`;

      manga.thumbnail_url = this.parseUrlFormStyle(mangaEl.selectFirst("div.img")) ?? undefined;
      // update_strategy = ONLY_FETCH_ONCE: no SManga field for it in the SDK
      mangas.push(manga);
    }
    const hasNextPage = document.selectFirst(this.nextPageSelector) != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private parseUrlFormStyle(element: Element | null | undefined): string | null {
    if (!element) return null;
    return this.styleUrlRegex.exec(element.attr("style"))?.[1] ?? null;
  }

  private parseInfosByIcon(infoCardElement: Element, iconClass: string): string[] | null {
    const text = infoCardElement.selectFirst(`div.item:has(.icon > ${iconClass})`)?.selectFirst("div.text");
    return text ? text.children().map((it) => it.text()) : null;
  }

  private parseInfoByIcon(infoCardElement: Element, iconClass: string): string | null {
    return infoCardElement.selectFirst(`div.item:has(.icon > ${iconClass})`)?.selectFirst("div.text")?.text() ?? null;
  }

  private parseUploadDateFromVersionInfo(doc: Element): number | null {
    for (const info of doc.select("div.tab-content > div.info-card div.text")) {
      const date = this.dateRegex.exec(info.text());
      if (!date) continue;
      return this.dateFormat.tryParseDate(date[0]);
    }
    return null;
  }
}
