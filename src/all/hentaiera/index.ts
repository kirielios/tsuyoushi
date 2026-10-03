// Port of keiyoushi/extensions-source src/all/hentaiera/HentaiEra.kt
import { isNotBlank, substringAfter, substringAfterLast, type Document, type Element } from "../../../sdk/index.ts";
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
  SearchFlagFilter,
  SortOrderFilter,
  imgAttr,
} from "../../../themes/galleryadults/index.ts";

const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s);

export default class HentaiEra extends GalleryAdults {
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

  protected override useIntermediateSearch = true;
  protected override supportSpeechless = true;

  protected override mangaTitleSelector = ".gallery_title";

  protected override mangaLangOf(element: Element): string {
    const href = element.selectFirst("a:has(.g_flag)")?.attr("href");
    if (href != null) return substringAfterLast(removeSuffix(href, "/"), "/");
    const flag = element
      .selectFirst(".g_flag")
      ?.className()
      .split(/\s+/)
      .find((it) => it.startsWith("flag-"));
    const fromFlag = flag != null ? this.langFlags[substringAfter(flag, "flag-")] : undefined;
    return fromFlag ?? this.mangaLang;
  }

  private get langFlags(): Record<string, string> {
    const map: Record<string, string> = Object.fromEntries(this.getLanguageURIs().map((it) => [it[1], it[0]]));
    // Keep the existing English flag alias in case the site uses `flag-us`
    if (!("us" in map)) map["us"] = LANGUAGE_ENGLISH;
    return map;
  }

  protected override get popularMangaUrl(): string {
    if (!isNotBlank(this.mangaLang)) {
      // LANGUAGE_MULTI popular
      const popularFilter = new SortOrderFilter(this.getSortOrderURIs());
      popularFilter.state = 0;
      return this.basicSearchUrl(0, "", [popularFilter]);
    }
    return super.popularMangaUrl;
  }

  /* Details */
  protected getInfoSelector(tag: string) {
    return `li:has(.tags_text:contains(${tag})) .tag .item_name`;
  }

  protected override getCover(element: Element) {
    const img = element.selectFirst(".left_cover img");
    return img ? imgAttr(img) : null;
  }

  /* Filters */
  protected override tagsParser(document: Document) {
    const out: Record<string, string> = {};
    for (const it of document.select(".galleries .gallery_title a")) out[it.ownText()] = substringAfterLast(removeSuffix(it.attr("href"), "/"), "/");
    return out;
  }

  protected override mangaDetailInfoSelector = ".gallery_first";

  /* Pages */
  protected override thumbnailSelector = ".gthumb";
  protected override pageUri = "view";

  protected override getCategoryURIs() {
    return [
      new SearchFlagFilter("Manga", "mg"),
      new SearchFlagFilter("Doujinshi", "dj"),
      new SearchFlagFilter("Western", "ws"),
      new SearchFlagFilter("Image Set", "is"),
      new SearchFlagFilter("Artist CG", "ac"),
      new SearchFlagFilter("Game CG", "gc"),
    ];
  }
}
