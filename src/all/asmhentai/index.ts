// Port of keiyoushi/extensions-source src/all/asmhentai/AsmHentai.kt
import { Filter, isNotBlank, substringAfter, substringAfterLast, type Document, type Element, type FilterList } from "../../../sdk/index.ts";
import { GalleryAdults, LANGUAGE_CHINESE, LANGUAGE_ENGLISH, LANGUAGE_JAPANESE, LANGUAGE_MULTI, imgAttr } from "../../../themes/galleryadults/index.ts";

const removeSuffix = (s: string, suffix: string) => (s.endsWith(suffix) ? s.slice(0, -suffix.length) : s);

export default class AsmHentai extends GalleryAdults {
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

  override get supportsLatest() {
    return isNotBlank(this.mangaLang);
  }
  protected override supportSpeechless = true;

  protected override mangaLangOf(element: Element) {
    return substringAfterLast(removeSuffix(element.select("a:has(.flag)").attr("href"), "/"), "/");
  }

  protected override mangaUrl(element: Element) {
    return element.selectFirst(".image a")?.attr("abs:href") ?? null;
  }

  protected override mangaThumbnail(element: Element) {
    const img = element.selectFirst(".image img");
    return img ? imgAttr(img) : null;
  }

  protected override popularMangaSelector() {
    return ".preview_item";
  }

  protected override favoritePath = "inc/user.php?act=favs";

  protected getInfoSelector(tag: string) {
    return `.tags:contains(${tag}:) .tag_list a`;
  }

  protected override infoTagName(element: Element) {
    return element.selectFirst(".tag")?.ownText() ?? "";
  }

  protected override getInfoPages(element: Element, _document: Document | null = null) {
    const t = element.selectFirst(".book_page .pages h3")?.ownText();
    return t != null ? substringAfter(t, ": ") : null;
  }

  protected override mangaDetailInfoSelector = ".book_page";

  protected override galleryIdSelector = "load_id";
  protected override thumbnailSelector = ".preview_thumb";

  protected override idPrefixUri = "g";
  protected override pageUri = "gallery";

  protected override pageRequestForm(document: Document, totalPages: string, loadedPages: number): URLSearchParams {
    const token = document.select("[name=csrf-token]").attr("content");

    const form = new URLSearchParams();
    form.append("id", this.inputIdValueOf(document, this.loadIdSelector));
    form.append("dir", this.inputIdValueOf(document, this.loadDirSelector));
    form.append("visible_pages", String(loadedPages));
    form.append("t_pages", totalPages);
    form.append("type", "2"); // 1 would be "more", 2 is "all remaining"
    if (token.trim()) form.append("_token", token);
    return form;
  }

  protected override tagsParser(document: Document) {
    const out: Record<string, string> = {};
    for (const it of document.select(".tags_page .tags a.tag")) out[it.ownText()] = substringAfterLast(removeSuffix(it.attr("href"), "/"), "/");
    return out;
  }

  override getFilterList(data: unknown = null): FilterList {
    return [new Filter.Header("HINT: Separate search term with comma (,)"), new Filter.Header("String query search doesn't support Sort"), ...super.getFilterList(data)];
  }
}
