// Port of keiyoushi/extensions-source src/en/tcbscans/TCBScans.kt
import {
  HttpUrl,
  KeiSource,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  urlWithoutDomain,
  type ClientBuilder,
  type FilterList,
} from "../../../sdk/index.ts";

const TITLE_REGEX = /\d+.?\d+$/;

export default class TCBScans extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  // addNetworkInterceptor upstream
  protected override configureClient(builder: ClientBuilder) {
    return builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      const response = await chain.proceed(request);

      if (request.url.startsWith(this.baseUrl) && ["mangas", "chapters"].includes(HttpUrl.parse(request.url).pathSegments[0]) && response.code === 404) {
        throw new Error("Migrate from TCB Scans to TCB Scans");
      }
      return response;
    });
  }

  // popular
  async getPopularManga(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/projects`)).asJsoup();
    const mangas = document.select("div.bg-card").map((element) => {
      const manga = SManga.create();
      const link = element.selectFirst("a[href].text-white")!;
      manga.url = urlWithoutDomain(link.absUrl("href"));
      manga.title = link.text();
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
      return manga;
    });
    return new MangasPage(mangas, false);
  }

  // latest
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // search
  async getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const mangas = (await this.getPopularManga(page)).mangas.filter((it) => it.title.toLowerCase().includes(query.toLowerCase()));
    return new MangasPage(mangas, false);
  }

  // manga details & chapters
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const details = SManga.create();
    details.url = manga.url;
    const order1 = document.selectFirst("div.order-1")!;
    details.thumbnail_url = order1.selectFirst("img")?.absUrl("src");
    details.title = order1.selectFirst("h1")!.text();
    details.description = order1.selectFirst("p")?.text();

    const chapterList = document.select("div.grid a").map((element) => {
      const chapter = SChapter.create();
      chapter.url = urlWithoutDomain(element.absUrl("href"));

      const title = element.select("div.font-bold:not(.flex)").text();
      const text = element.selectFirst(".text-gray-500")?.text();
      const description = text ? text : null;
      const chapNumber = TITLE_REGEX.exec(title)?.[0];

      let name = chapNumber !== undefined ? `Chapter ${chapNumber}` : title;
      if (description !== null) name += `: ${description}`;
      chapter.name = name;
      return chapter;
    });

    return new SMangaUpdate(details, chapterList);
  }

  // pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("picture img, .image-container img").map((img, i) => new Page(i, "", img.absUrl("src")));
  }

  // upstream's init {} deletes legacy Android shared_prefs files (source_<id>_updateTime*.xml); not applicable here.
}
