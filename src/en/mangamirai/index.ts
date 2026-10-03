// Port of keiyoushi/extensions-source src/en/mangamirai/MangaMirai.kt
import {
  Filter, FilterList, HttpSource, MangasPage, Page, SChapter, SManga, SwitchPreferenceCompat, firstInstance, urlWithoutDomain, toHttpUrl,
  type ClientBuilder, type PreferenceScreen, type Request, type Response,
} from "../../../sdk/index.ts";
import { GET } from "../../../sdk/httpsource.ts";
import { AuthorFilter, GenreFilter, PublisherFilter, SortFilter, TagFilter, addFilter } from "./filters.ts";
import { imageInterceptor } from "./imageinterceptor.ts";

interface ViewerResponse {
  records: { page: number; scramble_key: string; url: string }[];
}

const HIDE_LOCKED_PREF_KEY = "hide_locked";

export default class MangaMirai extends HttpSource {
  override get supportsLatest() {
    return true;
  }

  private get acceptHeaders(): Headers {
    const h = this.headersBuilder();
    h.set("Accept", "*/*");
    return h;
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addChainInterceptor((chain) => imageInterceptor(this.host, chain))
      .addChainInterceptor(async (chain) => {
        const request = chain.request();
        const response = await chain.proceed(request);
        const segments = toHttpUrl(request.url).pathSegments;
        if (response.code === 500 && segments[segments.length - 1] === "product_content_images") {
          throw new Error("Log in via WebView and purchase this chapter to read.");
        }
        return response;
      });
  }

  protected popularMangaRequest(page: number): Request {
    const sort = new SortFilter();
    sort.state = 1;
    return this.searchMangaRequest(page, "", FilterList(sort, new GenreFilter(), new TagFilter(), new AuthorFilter(), new PublisherFilter()));
  }
  protected popularMangaParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  protected latestUpdatesRequest(page: number): Request {
    const sort = new SortFilter();
    sort.state = 0;
    return this.searchMangaRequest(page, "", FilterList(sort, new GenreFilter(), new TagFilter(), new AuthorFilter(), new PublisherFilter()));
  }
  protected latestUpdatesParse(response: Response): MangasPage {
    return this.searchMangaParse(response);
  }

  protected searchMangaRequest(page: number, query: string, filters: FilterList): Request {
    const sort = firstInstance(filters, SortFilter);
    const genre = firstInstance(filters, GenreFilter);
    const tag = firstInstance(filters, TagFilter);
    const author = firstInstance(filters, AuthorFilter);
    const publisher = firstInstance(filters, PublisherFilter);
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.append("word", query);
    url.searchParams.append("page", String(page));
    url.searchParams.append("order", sort.value);
    url.searchParams.append("genre", genre.value);
    tag.state.forEach((it) => addFilter(url, "tags[]", it));
    author.state.forEach((it) => addFilter(url, "authors[]", it));
    url.searchParams.append("publisher", publisher.value);
    return GET(url, this.headers);
  }

  protected searchMangaParse(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select("div.card").map((it) => {
      const manga = SManga.create();
      manga.title = it.selectFirst("h3")!.text();
      manga.thumbnail_url = it.selectFirst("img")?.absUrl("src") || undefined;
      const segs = toHttpUrl(it.selectFirst("a")!.absUrl("href")).pathSegments;
      manga.url = urlWithoutDomain(segs[segs.length - 1]);
      return manga;
    });
    const hasNextPage = document.selectFirst("a[rel=next]") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Note: Search and active filters are applied together"), new SortFilter(), new GenreFilter(), new TagFilter(), new AuthorFilter(), new PublisherFilter());
  }

  override mangaDetailsRequest(manga: SManga): Request {
    return GET(`${this.baseUrl}/product_collections/${manga.url}`, this.headers);
  }

  protected mangaDetailsParse(response: Response): SManga {
    const document = response.asJsoup();
    const manga = SManga.create();
    manga.title = document.selectFirst("h1")!.text();
    manga.author = document.select("h1 ~ table a[href^=/authors/]").map((it) => it.text()).join(", ");
    manga.description = document.selectFirst("span[data-product-collections--product-collection--long-description-accordion-target]")?.text();
    manga.genre = document.select("div.hidden > .popular-categories a").map((it) => it.text()).join(", ");
    manga.status = document.selectFirst(".popular-categories a[href*=/tags/Completed]") != null ? SManga.COMPLETED : SManga.ONGOING;
    manga.thumbnail_url = document.selectFirst("div.grid-cols-5.justify-between img")?.absUrl("src") || undefined;
    return manga;
  }

  override async fetchChapterList(manga: SManga): Promise<SChapter[]> {
    const hideLocked = this.preferences.getBoolean(HIDE_LOCKED_PREF_KEY, false);
    const chapters: SChapter[] = [];
    let page = 1;
    let document;

    do {
      const url = new URL(`${this.baseUrl}/product_collections/${manga.url}`);
      url.searchParams.append("page", String(page));
      const response = await this.client.execute(GET(url, this.headers));
      document = response.asJsoup();

      for (const it of document.select("div.pb-5")) {
        const isBought = it.selectFirst("a.gtm_read") != null;
        const isFree = it.selectFirst("a.gtm_read_for_free") != null;
        const isPreview = it.selectFirst("a.gtm_preview") != null;
        const isLocked = !isBought && !isFree && !isPreview;

        if (hideLocked && (isPreview || isLocked)) continue;

        const reader = it.selectFirst("a[href*=/book_reader]")?.absUrl("href");
        const readerUrl = reader ? toHttpUrl(reader).pathSegments[2] : toHttpUrl(it.selectFirst("a.gtm_thumbnail_tap")!.absUrl("href")).pathSegments[3];

        const chapter = SChapter.create();
        chapter.url = urlWithoutDomain(readerUrl);
        chapter.name = (isPreview ? "🔒 (Preview) " : isLocked ? "🔒 " : "") + it.selectFirst("h3 span.font-bold")!.text();
        chapters.push(chapter);
      }
      page++;
    } while (document.selectFirst("a[rel=next]") != null);

    return chapters.reverse();
  }

  override getChapterUrl(chapter: SChapter): string {
    return `${this.baseUrl}/users/product_contents/${chapter.url}/book_reader`;
  }

  protected override pageListRequest(chapter: SChapter): Request {
    const url = new URL(`${this.baseUrl}/users/product_contents/${chapter.url}/product_content_images`);
    url.searchParams.append("start_page", "1");
    url.searchParams.append("limit", "10000");
    return GET(url, this.acceptHeaders);
  }

  protected pageListParse(response: Response): Page[] {
    const result = response.parseAs<ViewerResponse>();
    return result.records.map((it) => new Page(it.page, "", `${it.url}#${it.scramble_key}`));
  }

  override setupPreferenceScreen(screen: PreferenceScreen): void {
    const p = new SwitchPreferenceCompat(screen.context);
    p.key = HIDE_LOCKED_PREF_KEY;
    p.title = "Hide Locked Chapters";
    p.setDefaultValue(false);
    screen.addPreference(p);
  }

  protected chapterListParse(_response: Response): SChapter[] {
    throw new Error("UnsupportedOperationException");
  }
  protected imageUrlParse(_response: Response): string {
    throw new Error("UnsupportedOperationException");
  }
}
