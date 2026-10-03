// Port of keiyoushi/extensions-source src/en/mangabolt/MangaBolt.kt
import { FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, distinctBy, substringAfter, substringBefore } from "../../../sdk/index.ts";

interface MangaListDto {
  mangas: MangaDto[];
  next_page_url?: string | null;
}

interface MangaDto {
  name: string;
  slug: string;
  image_url?: string | null;
}

/** URLEncoder.encode(s, "UTF-8") */
const urlEncode = (s: string) => encodeURIComponent(s).replace(/%20/g, "+").replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export default class MangaBolt extends KeiSource {
  // Popular
  getPopularManga(page: number): Promise<MangasPage> {
    return this.getMangaList(page, "");
  }

  // The site 301s any path without a trailing slash by appending "/" to the whole URL, so a
  // throwaway "_=/" parameter keeps the real query parameters intact.
  private async getMangaList(page: number, query: string): Promise<MangasPage> {
    let url = `${this.baseUrl}/manga-list/?page=${page}`;
    if (query.length > 0) url += `&search=${urlEncode(query)}`;
    url += "&_=/";
    const apiHeaders = new Headers(this.headers);
    apiHeaders.set("X-Requested-With", "XMLHttpRequest");
    apiHeaders.set("Accept", "application/json");
    const data = (await this.client.get(url, apiHeaders)).parseAs<MangaListDto>();
    const mangas = data.mangas.map((it) => {
      const manga = SManga.create();
      manga.url = `/manga/${it.slug}/`;
      manga.title = it.name;
      manga.thumbnail_url = it.image_url ?? undefined;
      return manga;
    });
    return new MangasPage(mangas, data.next_page_url != null);
  }

  // Latest
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/latest`)).asJsoup();
    const list: SManga[] = [];
    for (const element of document.select("div.bg-bg-secondary:has(a[href*=/chapter/])")) {
      const link = element.selectFirst("a[href*=/chapter/]")?.attr("href");
      if (link == null) continue;

      const slug = substringBefore(substringAfter(link, "/chapter/", ""), "-chapter-", "");
      if (slug.length === 0) continue;

      const manga = SManga.create();
      manga.url = `/manga/${slug}/`;
      manga.title = substringBefore(element.select(".font-bold").text(), "Chapter").trim();
      if (manga.title.length === 0) continue;
      manga.thumbnail_url = element.selectFirst("img")?.attr("abs:src");
      list.push(manga);
    }

    return new MangasPage(distinctBy(list, (it) => it.url), false);
  }

  // Search
  getSearchMangaList(page: number, query: string, _filters: FilterList): Promise<MangasPage> {
    return this.getMangaList(page, query.trim());
  }

  // Details & Chapters
  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();

    const title = document.selectFirst("#main-content h1")?.text().trim();
    if (!title) throw new Error("Missing title");
    manga.title = title;
    manga.description = document.select("div.bg-bg-secondary div.px-6 div.flex-col div.text-text-muted").text().trim();
    manga.thumbnail_url = document.selectFirst("div.flex img")?.attr("abs:src");

    const chapterList: SChapter[] = [];
    for (const element of document.select("div.w-full div.bg-bg-secondary:has(div.grid)")) {
      const link = element.selectFirst("div.grid a");
      if (!link) continue;
      const chapter = SChapter.create();
      chapter.name = link.text();
      const text = link.parent()?.selectFirst(".text-xs")?.text();
      const secondaryTitle = text != null && text.toLowerCase() !== "read" ? text : "";
      if (secondaryTitle.length > 0) {
        chapter.name += ` - ${secondaryTitle}`;
      }
      chapter.url = link.attr("abs:href");
      chapterList.push(chapter);
    }

    return new SMangaUpdate(manga, chapterList);
  }

  // Pages
  override getChapterUrl(chapter: SChapter): string {
    return chapter.url;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    const urls = document
      .select(".js-pages-container img.js-page")
      .filter((it) => !it.parents().some((parent) => parent.tagName() === "noscript"))
      .map((img) => (img.hasAttr("data-src") ? img.attr("abs:data-src") : img.attr("abs:src")))
      .filter((it) => it.length > 0 && !it.includes("data:image"));
    return [...new Set(urls)].map((url, index) => new Page(index, "", url));
  }
}
