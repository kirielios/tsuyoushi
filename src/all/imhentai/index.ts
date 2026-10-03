// Port of keiyoushi/extensions-source src/all/imhentai/IMHentai.kt
import { substringAfterLast, type ClientBuilder, type Element } from "../../../sdk/index.ts";
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

export default class IMHentai extends GalleryAdults {
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
  protected override supportAdvancedSearch = true;
  protected override supportSpeechless = true;

  protected override mangaLangOf(element: Element) {
    return substringAfterLast(removeSuffix(element.select("a:has(.thumb_flag)").attr("href"), "/"), "/");
  }

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder
      .addInterceptor((request) => {
        const headers = new Headers(request.headers);
        headers.delete("Accept-Encoding");
        return { ...request, headers };
      })
      .addChainInterceptor(async (chain) => {
        const response = await chain.proceed(chain.request());
        if (!(response.header("Content-Type") ?? "").includes("text/html")) return response;

        if (response.text().includes("Overload... Please use the advanced search")) {
          throw new Error("IMHentai search is overloaded try again later");
        }
        return response;
      });
  }

  protected getInfoSelector(tag: string) {
    return `li:has(.tags_text:contains(${tag}:)) a.tag`;
  }

  protected override getCover(element: Element) {
    const img = element.selectFirst(".left_cover img");
    return img ? imgAttr(img) : null;
  }

  protected override mangaDetailInfoSelector = ".gallery_first";

  /* Pages */
  protected override thumbnailSelector = ".gthumb";
  protected override pageUri = "view";
}
