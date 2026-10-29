// Port of keiyoushi/extensions-source src/all/hentairox/HentaiRox.kt
import { Page, parseAs, parseHtml, substringAfterLast, substringBeforeLast, type Document, type Element, type SChapter, type SManga } from "../../../sdk/index.ts";
import { GalleryAdults, LANGUAGE_ENGLISH, LANGUAGE_JAPANESE, LANGUAGE_MULTI, imgAttr } from "../../../themes/galleryadults/index.ts";

const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s);
const trimEndSlash = (s: string) => s.replace(/\/+$/, "");

type RelatedResponse = { html: string };
type ReaderPage = { page: number; ext: string };

export default class HentaiRox extends GalleryAdults {
  protected override mangaLang = (() => {
    switch (this.lang) {
      case "en":
        return LANGUAGE_ENGLISH;
      case "ja":
        return LANGUAGE_JAPANESE;
      case "all":
        return LANGUAGE_MULTI;
      default:
        throw new Error(`Invalid lang: ${this.lang}`);
    }
  })();

  protected override supportSpeechless = true;

  protected override basicSearchKey = "key";

  /* List */

  protected override popularMangaSelector() {
    return "article.hr-gallery-card";
  }

  protected override mangaTitleSelector = ".hr-gallery-card__title";

  protected override mangaUrl(element: Element) {
    return element.selectFirst(".hr-gallery-card__cover")?.attr("abs:href") ?? null;
  }

  protected override mangaThumbnail(element: Element) {
    const img = element.selectFirst(".hr-gallery-card__media img");
    return img ? imgAttr(img) : null;
  }

  protected override mangaLangOf(element: Element) {
    return substringAfterLast(removeSuffix(element.selectFirst(".hr-gallery-card__flag")?.attr("href") ?? "", "/"), "/");
  }

  // The site has no language-independent popular/latest listing, so the search
  // endpoint (sorted by popularity or by newest) covers all languages instead.
  protected override get popularMangaUrl(): string {
    return this.mangaLang.trim() === "" ? `${this.baseUrl}/search/?sort=popular` : super.popularMangaUrl;
  }

  protected override get latestUpdatesUrl(): string {
    return this.mangaLang.trim() === "" ? `${this.baseUrl}/search/` : super.latestUpdatesUrl;
  }

  /* Details */

  protected override mangaDetailInfoSelector = ".hr-gallery-overview";

  protected override getCover(element: Element) {
    const img = element.selectFirst(".hr-gallery-cover img");
    return img ? imgAttr(img) : null;
  }

  protected getInfoSelector(tag: string) {
    return `.hr-gallery-entity-group:has(.hr-gallery-entity-label:contains(${tag})) .hr-gallery-tag`;
  }

  protected override infoTagName(element: Element) {
    return element.selectFirst(".hr-gallery-tag__name")?.text() ?? "";
  }

  protected override totalPages(element: Element) {
    return element.selectFirst("#js-thumbs-grid")?.attr("data-total-pages") ?? "";
  }

  /* Related */

  override async fetchRelatedMangaList(manga: SManga): Promise<SManga[]> {
    const id = substringAfterLast(trimEndSlash(manga.url), "/");
    const html = (await this.client.get(`${this.baseUrl}/api/gallery/${id}/related`, this.xhrHeaders)).parseAs<RelatedResponse>().html;
    return this.searchMangaFromElements(parseHtml(this.host.load, html, this.baseUrl).select(this.relatedMangaSelector()), false);
  }

  /* Pages */

  protected override pageUri = "g";

  override async getPageList(chapter: SChapter): Promise<Page[]> {
    const galleryId = substringAfterLast(trimEndSlash(chapter.url), "/");
    const document = (await this.client.get(`${this.baseUrl}/${this.pageUri}/${galleryId}/1/`)).asJsoup();

    const pagesJson = document.selectFirst("script#readerPagesJson")?.data();
    if (pagesJson == null) throw new Error("Failed to load page list");
    const img = document.selectFirst("img#readerImg");
    const imagesUri = img ? substringBeforeLast(imgAttr(img), "/") : null;
    if (imagesUri == null) throw new Error("Failed to load page list");

    return parseAs<ReaderPage[]>(pagesJson).map((it) => new Page(it.page - 1, `${this.baseUrl}/${this.pageUri}/${galleryId}/${it.page}/`, `${imagesUri}/${it.page}.${it.ext}`));
  }

  /* Filters */

  protected override tagsParser(document: Document) {
    const out: Record<string, string> = {};
    for (const card of document.select("article.hr-taxonomy-card")) {
      const it = card.selectFirst(".hr-taxonomy-card__title a");
      if (it) out[it.text()] = substringAfterLast(removeSuffix(it.attr("href"), "/"), "/");
    }
    return out;
  }
}
