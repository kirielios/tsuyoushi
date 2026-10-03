// Port of keiyoushi/extensions-source src/all/hentaizap/HentaiZap.kt
import { substringAfterLast, type Document, type Element } from "../../../sdk/index.ts";
import {
  GalleryAdults,
  LANGUAGE_ENGLISH,
  LANGUAGE_FRENCH,
  LANGUAGE_GERMAN,
  LANGUAGE_JAPANESE,
  LANGUAGE_KOREAN,
  LANGUAGE_MULTI,
  LANGUAGE_RUSSIAN,
  LANGUAGE_SPANISH,
  imgAttr,
} from "../../../themes/galleryadults/index.ts";

const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s);

export default class HentaiZap extends GalleryAdults {
  protected override mangaLang = (() => {
    switch (this.lang) {
      case "en":
        return LANGUAGE_ENGLISH;
      case "ja":
        return LANGUAGE_JAPANESE;
      case "es":
        return LANGUAGE_SPANISH;
      case "fr":
        return LANGUAGE_FRENCH;
      case "ko":
        return LANGUAGE_KOREAN;
      case "de":
        return LANGUAGE_GERMAN;
      case "ru":
        return LANGUAGE_RUSSIAN;
      case "all":
        return LANGUAGE_MULTI;
      default:
        throw new Error(`Invalid lang: ${this.lang}`);
    }
  })();

  protected override supportSpeechless = true;
  protected override useIntermediateSearch = true;

  protected override mangaThumbnail(element: Element) {
    const img = element.selectFirst(".hz-gallery-card__media.thumb img");
    return img ? imgAttr(img) : null;
  }
  protected override popularMangaSelector() {
    return ".hz-gallery-card";
  }

  protected override mangaTitleSelector = ".hz-gallery-card__title a";

  protected override mangaUrl(element: Element) {
    return element.selectFirst(".hz-gallery-card__cover")?.attr("abs:href") ?? null;
  }

  protected override mangaLangOf(element: Element) {
    return substringAfterLast(removeSuffix(element.select(".hz-gallery-card__flag").attr("href"), "/"), "/");
  }

  protected override basicSearchKey = "key";

  /* Details */
  protected override mangaDetailInfoSelector = ".hz-gallery-details";

  protected override getCover(element: Element) {
    const img = element.selectFirst(".hz-gallery-cover img");
    return img ? imgAttr(img) : null;
  }

  protected getInfoSelector(tag: string) {
    return `div.hz-gallery-entity-group:has(:contains(${tag}:)) a.hz-gallery-tag`;
  }

  protected override infoTagName(element: Element) {
    return element.selectFirst(".hz-gallery-tag__name")?.text() ?? element.ownText();
  }

  // pages
  protected override galleryId(element: Element) {
    return element.select("[data-gallery-id]").attr("data-gallery-id");
  }
  protected override totalPages(element: Element) {
    return element.select("[data-total-pages]").attr("data-total-pages");
  }

  protected override parsingImagePageByPage = true;

  // tags
  protected override tagsParser(document: Document) {
    const out: Record<string, string> = {};
    for (const it of document.select("ul.hz-legacy-taxonomy__items a")) out[it.select(".hz-legacy-taxonomy-item__name").text()] = substringAfterLast(removeSuffix(it.attr("href"), "/"), "/");
    return out;
  }

  // supportRelatedMangasBySearch = true: Komikku-only, the reader does not ask for related titles
}
