// Port of keiyoushi/extensions-source src/en/hentaikisu/HentaiKisu.kt (+ Dto.kt)
import { Base64, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, fromUtf8, toHttpUrl, urlWithoutDomain, type FilterList } from "../../../sdk/index.ts";

// Dto.kt
interface Dto {
  id: string;
  title: string;
  img: string;
}
function dtoToSManga(d: Dto): SManga {
  const manga = SManga.create();
  manga.url = `/g/${d.id}`;
  manga.title = d.title;
  manga.thumbnail_url = d.img;
  return manga;
}

const LA_REGEX = /la\s*=\s*'([A-Za-z0-9+/=]+)'/;

export default class HentaiKisu extends KeiSource {
  override get supportsLatest() {
    return false;
  }

  // ============================== Popular ==============================
  async getPopularManga(page: number): Promise<MangasPage> {
    const mangas = (await this.client.get(`${this.baseUrl}/backend/infinite.index.php?p=${page}`)).parseAs<Dto[]>().map(dtoToSManga);
    return new MangasPage(mangas, mangas.length > 0);
  }

  // ============================== Latest ===============================
  getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  // ============================== Search ===============================
  async getSearchMangaList(_page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder().addQueryParameter("s", query).build();
    const document = (await this.client.get(url.toString())).asJsoup();
    const elements = document.select("div.book-list a");

    const mangas: SManga[] = [];
    for (const element of elements) {
      // runCatching { ... }.getOrNull(): entries missing a title are skipped
      try {
        const manga = SManga.create();
        manga.url = urlWithoutDomain(element.absUrl("href"));
        manga.title = element.selectFirst("div.book-description p")!.text();
        manga.thumbnail_url = element.selectFirst("img.lozad")?.attr("abs:data-src");
        mangas.push(manga);
      } catch {
        // skipped
      }
    }

    return new MangasPage(mangas, false);
  }

  // ============================== Details ==============================
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.getMangaUrl(manga));
    const chapterUrl = new URL(response.url).pathname;
    const document = response.asJsoup();

    const details = SManga.create();
    details.title = document.selectFirst("div#info h1")!.text();
    details.thumbnail_url = document.selectFirst("div#cover img")?.attr("abs:src");
    details.artist = document.selectFirst("div.tag-container:contains(Artist:) span.tags")?.text();
    details.genre = document.select("div.tag-container:contains(Categories:) span.tags a.tag").map((it) => it.ownText()).join(", ");
    details.author = document.selectFirst("div.tag-container:contains(Group:) span.tags")?.text();
    details.status = SManga.COMPLETED;
    // update_strategy = UpdateStrategy.ONLY_FETCH_ONCE: no SManga field here

    const chapter = SChapter.create();
    chapter.url = chapterUrl;
    chapter.name = "Chapter";
    chapter.date_upload = 0;

    return new SMangaUpdate(details, [chapter]);
  }

  // =============================== Pages ===============================
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const readUrl = chapter.url.replace("/g/", "/read/");
    const document = (await this.client.get(this.baseUrl + readUrl)).asJsoup();
    const scriptContent = document.selectFirst("script:containsData(la =)")?.data();
    if (scriptContent == null) throw new Error("Could not find page data");

    const base64Data = LA_REGEX.exec(scriptContent)?.[1];
    if (base64Data == null) throw new Error("Could not extract base64 data");

    const decodedString = fromUtf8(Base64.decode(base64Data));

    return decodedString.split(",").map((url, index) => new Page(index, "", url));
  }
}
