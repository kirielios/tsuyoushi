// Port of keiyoushi/extensions-source src/all/hentairox/HentaiRox.kt
import { isNotBlank, substringAfterLast, type Document, type Element } from "../../../sdk/index.ts";
import { GalleryAdults, LANGUAGE_CHINESE, LANGUAGE_ENGLISH, LANGUAGE_JAPANESE, LANGUAGE_MULTI, imgAttr } from "../../../themes/galleryadults/index.ts";

const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s);

export default class HentaiRox extends GalleryAdults {
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

  protected override supportSpeechless = true;

  protected override basicSearchKey = "key";

  protected override mangaLangOf(element: Element) {
    return substringAfterLast(removeSuffix(element.select("a:has(.thumb_flag)").attr("href"), "/"), "/");
  }

  protected override mangaTitleSelector = ".gallery_title";

  protected override get popularMangaUrl(): string {
    return !isNotBlank(this.mangaLang) ? `${this.baseUrl}/top-rated` : super.popularMangaUrl; // LANGUAGE_MULTI
  }

  /**
   * Convert space( ) typed in search-box into plus(+) in URL. Then:
   * - ignore the word preceding by a special character (e.g. 'school-girl' will ignore 'girl')
   *    => replace to plus(+),
   * - use plus(+) for separate terms, as AND condition.
   * - use double quote(") to search for exact match.
   */
  protected override buildQueryString(tags: string[], query: string): string {
    const regexSpecialCharacters = /[^a-zA-Z0-9"]+(?=[a-zA-Z0-9"])/g;
    return [...tags, query, this.mangaLang]
      .filter(isNotBlank)
      .map((it) => it.trim().replace(regexSpecialCharacters, "+"))
      .join("+");
  }

  /* Details */
  protected getInfoSelector(tag: string) {
    return `li:has(.tags_text:contains(${tag})) a.tag`;
  }
  protected override infoTagName(element: Element) {
    return element.selectFirst(".item_name")?.ownText() ?? "";
  }

  protected override getCover(element: Element) {
    const img = element.selectFirst(".left_cover img");
    return img ? imgAttr(img) : null;
  }

  protected override mangaDetailInfoSelector = ".gallery_first";

  /* Pages */
  protected override thumbnailSelector = ".gthumb";
  protected override pageUri = "view";

  /* Filters */
  protected override tagsParser(document: Document) {
    const out: Record<string, string> = {};
    for (const it of document.select(".gtags .gallery_title a")) out[it.ownText()] = substringAfterLast(removeSuffix(it.attr("href"), "/"), "/");
    return out;
  }

  protected override relatedMangaSelector() {
    return `.related_galleries ~ ${this.popularMangaSelector()}`;
  }
}
