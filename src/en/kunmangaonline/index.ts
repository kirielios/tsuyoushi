// Port of keiyoushi/extensions-source src/en/kunmangaonline/KunMangaOnline.kt
import { ClientBuilder, toHttpUrl, type Document, type Element, type Page, type SChapter } from "../../../sdk/index.ts";
import { MadaraNoAjax } from "../../../themes/madara/index.ts";
import { toSChapter, type ChapterListResponse } from "./Dto.ts";

const CHAPTERS_PER_PAGE = 50;

export default class KunMangaOnline extends MadaraNoAjax {
  protected override supportsPostId = false;
  protected override configureClient(b: ClientBuilder) {
    return b.rateLimit(2);
  }

  private get apiHeaders() {
    const h = this.headersBuilder();
    h.append("Accept", "application/json");
    return h;
  }

  protected override archiveSelector() {
    return ".c-tabs-item__content, .page-item-detail";
  }
  protected override archiveUrlSelector = ".post-title a, h3.h4 a";
  protected override nextPageSelector() {
    return "a[aria-label=Next]";
  }

  override getChapterUrl(chapter: SChapter) {
    return `${this.baseUrl}${chapter.url}`;
  }

  protected override async fetchChapters(mangaPath: string, _id: string, _mangaPage: Document | null = null): Promise<SChapter[]> {
    const slug = toHttpUrl(`${this.baseUrl}${mangaPath}`).pathSegments[1];
    if (slug == null) return [];

    const firstUrl = `${this.baseUrl}/api/comics/${slug}/chapters?page=1&per_page=${CHAPTERS_PER_PAGE}&order=desc`;
    const firstPage = (await this.client.get(firstUrl, this.apiHeaders)).parseAs<ChapterListResponse>().data;

    const allChapters = firstPage.chapters.map((it) => toSChapter(it, slug));

    if (firstPage.last_page > 1) {
      const pages = Array.from({ length: firstPage.last_page - 1 }, (_, i) => i + 2);
      const rest = await Promise.all(
        pages.map(async (page) => {
          const apiUrl = toHttpUrl(firstUrl).newBuilder().setQueryParameter("page", String(page)).build();
          return (await this.client.get(apiUrl.toString(), this.apiHeaders)).parseAs<ChapterListResponse>().data.chapters;
        }),
      );
      for (const chapters of rest) allChapters.push(...chapters.map((it) => toSChapter(it, slug)));
    }

    return allChapters;
  }

  protected override imageFromElement(element: Element): string | null {
    const host = toHttpUrl(this.baseUrl).host;
    return (
      ["data-backup", "src", "data-src", "data-lazy-src", "data-aload"].map((it) => element.absUrl(it)).find((it) => it.startsWith("http") && !it.includes(`${host}/thumb/`)) ?? null
    );
  }

  override imageRequest(page: Page) {
    const request = super.imageRequest(page);
    request.headers.set("Referer", `${this.baseUrl}/`);
    return request;
  }
}
