// Port of keiyoushi/extensions-source src/en/sabrinaonline/SabrinaOnline.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, urlWithoutDomain, type Element } from "../../../sdk/index.ts";

export default class SabrinaOnline extends KeiSource {
  override get supportsLatest(): boolean {
    return false;
  }

  manga(): SManga {
    const manga = SManga.create();
    manga.title = "Sabrina Online";
    manga.thumbnail_url = `https://dummyimage.com/768x994/000/ffffff.jpg&text=${manga.title}`;
    manga.artist = "Eric W. Schwartz";
    manga.author = "Eric W. Schwartz";
    manga.status = SManga.UNKNOWN;
    manga.url = urlWithoutDomain(`${this.baseUrl}/archive.html`);
    return manga;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    return new MangasPage([this.manga()], false);
  }

  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new Error("UnsupportedOperationException");
  }

  async getSearchMangaList(_page: number, _query: string, _filters: FilterList): Promise<MangasPage> {
    return new MangasPage([], false);
  }

  async fetchMangaUpdate(_manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchChapters) return new SMangaUpdate(this.manga(), chapters);

    const document = (await this.client.get(`${this.baseUrl}/archive.html`)).asJsoup();
    const chapterList: SChapter[] = [];

    // turn cells into chapters, with the section name if present
    const trToChapters = (tr: Element, sections: string[]): SChapter[] => {
      const chapters: SChapter[] = [];

      tr.select("td").forEach((td, index) => {
        td.select("a").forEach((a) => {
          const chapterName = a.text();
          if (chapterName.length === 0) return;

          const section = sections[index];
          const hasYear = section != null && section.length > 0 && /\d/.test(section[0]);
          const chapter = SChapter.create();
          chapter.url = urlWithoutDomain(a.absUrl("href"));
          chapter.name = hasYear ? `${section} ${chapterName}` : chapterName;
          chapters.push(chapter);
        });
      });

      return chapters;
    };

    const rows = [...document.select("center table tr")];
    for (let i = 0; i < rows.length; i += 2) {
      const pair = rows.slice(i, i + 2);
      if (pair.length < 2) {
        chapterList.push(...trToChapters(pair[0], []));
      } else {
        const sections = pair[0].select("td").map((it) => it.text().trim());
        // use the section names if there are any in the first row
        if (sections.length > 0) {
          chapterList.push(...trToChapters(pair[1], sections));
        } else {
          chapterList.push(...trToChapters(pair[1], []));
          chapterList.push(...trToChapters(pair[0], []));
        }
      }
    }

    return new SMangaUpdate(this.manga(), chapterList.reverse());
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(`${this.baseUrl}${chapter.url}`)).asJsoup();
    const pages = document.select("center img").filter((it) => it.hasAttr("src") && (it.attr("src").includes("strips/") || it.attr("src").includes("pages/")));

    return pages.map((img, index) => {
      // use full image instead of preview if available
      const parent = img.parent();
      if (parent?.tagName() === "a") {
        const href = parent.absUrl("href") || parent.attr("href");
        return new Page(index, "", href);
      }
      const src = img.absUrl("src") || img.attr("src");
      return new Page(index, "", src);
    });
  }
}
