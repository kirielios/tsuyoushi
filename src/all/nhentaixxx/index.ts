// Port of keiyoushi/extensions-source src/all/nhentaixxx/NHentaiXXX.kt
import { isNotBlank, substringAfter, substringBefore, type Document, type Element } from "../../../sdk/index.ts";
import { GalleryAdults, LANGUAGE_CHINESE, LANGUAGE_ENGLISH, LANGUAGE_JAPANESE, LANGUAGE_MULTI, SortOrderFilter, imgAttr } from "../../../themes/galleryadults/index.ts";

export default class NHentaiXXX extends GalleryAdults {
  protected override mangaLang = (() => {
    switch (this.lang) {
      case "en":
        return LANGUAGE_ENGLISH;
      case "ja":
        return LANGUAGE_JAPANESE;
      case "zh":
        return LANGUAGE_CHINESE;
      case "all":
        return LANGUAGE_MULTI;
      default:
        throw new Error(`Invalid lang: ${this.lang}`);
    }
  })();

  // This site treats all Speechless as English
  protected override supportSpeechless = this.mangaLang === LANGUAGE_ENGLISH;

  private readonly languages: [string, string][] = [
    [LANGUAGE_ENGLISH, "1"],
    [LANGUAGE_JAPANESE, "2"],
    [LANGUAGE_CHINESE, "3"],
  ];
  private readonly langCode = this.languages.find((lang) => lang[0] === this.mangaLang)?.[1];

  protected override mangaLangOf(element: Element) {
    return element.attr("data-languages") === this.langCode ? this.mangaLang : "other";
  }

  protected override mangaUrl(element: Element) {
    return element.selectFirst(".gallery_item a, .fav_item a")?.attr("abs:href") ?? null;
  }

  protected override mangaThumbnail(element: Element) {
    const img = element.selectFirst(".gallery_item img, .fav_item img");
    return img ? imgAttr(img) : null;
  }

  protected override get popularMangaUrl(): string {
    if (!isNotBlank(this.mangaLang)) {
      // LANGUAGE_MULTI
      const popularFilter = new SortOrderFilter(this.getSortOrderURIs());
      popularFilter.state = 0;
      return this.basicSearchUrl(0, "", [popularFilter]);
    }
    return super.popularMangaUrl;
  }

  protected override popularMangaSelector() {
    return ".galleries_box .gallery_item, .fav_item";
  }

  protected override basicSearchKey = "key";

  protected override favoritePath = "favorites";

  protected override idPrefixUri = "g";

  protected override loginRequired(document: Document, url: string): boolean {
    return url.includes("/login/") && document.select("button[name=go_login]").length > 0;
  }

  protected getInfoSelector(tag: string) {
    return `.tags:contains(${tag}) a.tag_btn`;
  }
  protected override infoTagName(element: Element) {
    return element.selectFirst(".tag_name")?.ownText() ?? "";
  }

  protected override serverPrefix = "i";

  protected override parseJson(element: Element): string | null {
    const data = element.select("script").find((s) => s.data().includes("parseJSON"))?.data();
    if (data == null) return null;
    return substringBefore(substringAfter(data, `$.parseJSON('{"fl":`), `,"th":`).trim();
  }
}
