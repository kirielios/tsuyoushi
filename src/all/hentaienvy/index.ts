// Port of keiyoushi/extensions-source src/all/hentaienvy/HentaiEnvy.kt
import { Filter, isNotBlank, substringAfterLast, type Document, type Element, type FilterList } from "../../../sdk/index.ts";
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

export default class HentaiEnvy extends GalleryAdults {
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

  override get supportsLatest() {
    return isNotBlank(this.mangaLang);
  }
  protected override supportAdvancedSearch = true;
  protected override supportSpeechless = true;

  protected override mangaLangOf(element: Element) {
    return substringAfterLast(removeSuffix(element.select(".hnv-gallery-card__flag").attr("href"), "/"), "/");
  }

  protected override popularMangaSelector() {
    return ".hnv-gallery-card";
  }

  protected override mangaThumbnail(element: Element) {
    const img = element.selectFirst("a.hnv-gallery-card__cover img");
    return img ? imgAttr(img) : null;
  }

  protected override mangaTitleSelector = ".hnv-gallery-card__title";

  protected override mangaUrl(element: Element) {
    return element.selectFirst("a.hnv-gallery-card__cover")?.attr("abs:href") ?? null;
  }

  protected override basicSearchKey = "key";
  protected override advancedSearchUri = "advanced-search";
  protected override favoritePath = "inc/user.php?act=favs";

  /* Details */
  protected override mangaDetailInfoSelector = ".hnv-gallery-details";

  protected getInfoSelector(tag: string) {
    return `div.hnv-gallery-entity-group:has(:contains(${tag}:)) a.hnv-gallery-tag`;
  }
  protected override infoTagName(element: Element) {
    return element.selectFirst(".hnv-gallery-tag__name")?.text() ?? element.ownText();
  }

  protected override getCover(element: Element) {
    const img = element.selectFirst(".hnv-gallery-cover img");
    return img ? imgAttr(img) : null;
  }

  /* Pages */
  protected override galleryId(element: Element) {
    return element.select("[data-gallery-id]").attr("data-gallery-id");
  }
  protected override totalPages(element: Element) {
    return element.select("[data-total-pages]").attr("data-total-pages");
  }

  protected override parsingImagePageByPage = true;

  /* Filters */
  protected override tagsParser(document: Document) {
    const out: Record<string, string> = {};
    for (const it of document.select("ul.hnv-legacy-taxonomy__items a")) out[it.attr("title")] = substringAfterLast(removeSuffix(it.attr("href"), "/"), "/");
    return out;
  }

  override getFilterList(data: unknown = null): FilterList {
    return [new Filter.Header("String query search doesn't support Sort"), ...super.getFilterList(data)];
  }

  // supportRelatedMangasBySearch = true: Komikku-only, the reader does not ask for related titles
}
