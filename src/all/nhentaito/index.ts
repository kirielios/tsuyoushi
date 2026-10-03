// Port of keiyoushi/extensions-source src/all/nhentaito/NHentaiTo.kt
import { Filter, fromUtf8, parseAs, substringAfter, toHttpUrl, type ClientBuilder, type Element, type FilterList, type Response } from "../../../sdk/index.ts";
import {
  GalleryAdults,
  LANGUAGE_CHINESE,
  LANGUAGE_ENGLISH,
  LANGUAGE_JAPANESE,
  LANGUAGE_KOREAN,
  LANGUAGE_MULTI,
  SortOrderFilter,
  imgAttr,
  toDate,
} from "../../../themes/galleryadults/index.ts";

export class ExcludeFilter extends Filter.Text {
  constructor() {
    super("Exclude Tags (seperate by comma)");
  }
}

function isRealSuccess(response: Response) {
  return response.isSuccessful && !fromUtf8(response.bytes().slice(0, 64)).toLowerCase().includes("<html");
}

export default class NHentaiTo extends GalleryAdults {
  protected override mangaLang = (() => {
    switch (this.lang) {
      case "en":
        return LANGUAGE_ENGLISH;
      case "ja":
        return LANGUAGE_JAPANESE;
      case "zh":
        return LANGUAGE_CHINESE;
      case "ko":
        return LANGUAGE_KOREAN;
      case "all":
        return LANGUAGE_MULTI;
      default:
        throw new Error(`Invalid lang: ${this.lang}`);
    }
  })();

  protected override supportSpeechless = true;

  protected override searchPopularPath = "";

  protected override configureClient(builder: ClientBuilder): ClientBuilder {
    return builder.addChainInterceptor(async (chain) => {
      const request = chain.request();
      const hash = request.url.indexOf("#");
      let frag = hash < 0 ? "" : request.url.slice(hash + 1);
      try {
        frag = decodeURIComponent(frag);
      } catch {
        // keep as is
      }
      let response = await chain.proceed(request);

      if (!frag.startsWith("fallback") || isRealSuccess(response)) return response;

      for (const it of parseAs<string[]>(substringAfter(frag, "fallback"))) {
        response = await chain.proceed({ ...request, url: it });
        if (isRealSuccess(response)) return response;
      }
      return response;
    });
  }

  // popular

  protected override get popularMangaUrl(): string {
    const f = new SortOrderFilter([]);
    f.state = 2;
    return this.basicSearchUrl(0, "", [f]);
  }

  protected override get latestUpdatesUrl(): string {
    const f = new SortOrderFilter([]);
    f.state = 1;
    return this.basicSearchUrl(0, "", [f]);
  }

  protected override popularMangaSelector() {
    return ".gallery a:not([rel~=sponsored])";
  }
  protected override popularMangaNextPageSelector() {
    return "a.next";
  }

  protected override mangaUrl(element: Element) {
    return element.absUrl("href");
  }

  protected override getCover(element: Element) {
    const img = element.selectFirst("#cover img");
    return img ? this.withFallback(img) : null;
  }

  protected override mangaThumbnail(element: Element) {
    const img = element.selectFirst("img");
    return img ? this.withFallback(img) : null;
  }

  private withFallback(element: Element): string | null {
    const image = imgAttr(element);
    if (image === "") return null;
    const fallbacks = element.attr("data-fallbacks");
    return fallbacks.trim() === "" ? image : `${image}#fallback${fallbacks}`;
  }

  // Details
  protected override mangaDetailInfoSelector = "#bigcontainer";
  protected override idPrefixUri = "g";

  // Tags
  protected getInfoSelector(tag: string) {
    return `#info-block .field-name:contains(${tag}) .tags a`;
  }
  protected override infoTagName(element: Element) {
    return element.selectFirst(".name")?.ownText() ?? "";
  }

  // Pages
  protected override serverPrefix = "i";

  protected override totalPages(element: Element) {
    return this.getInfo(element, "Pages");
  }

  protected override getTime(element: Element) {
    return toDate(element.selectFirst(".tags time")?.attr("datetime"), null);
  }

  protected override thumbnailSelector = "#thumbnail-container .thumb-container";

  // search
  protected override basicSearchUrl(_page: number, query: string, filters: FilterList): string {
    const sortOrderFilter = filters.find((f): f is SortOrderFilter => f instanceof SortOrderFilter);
    const excludeTags = filters.find((f): f is ExcludeFilter => f instanceof ExcludeFilter);

    const builder = toHttpUrl(`${this.baseUrl}/search`).newBuilder();
    builder.addQueryParameter("q", query || "*");
    if (sortOrderFilter?.state != null) builder.addQueryParameter("sort", this.getSortOrderURIs()[sortOrderFilter.state][1]);
    if (excludeTags?.state != null) builder.addQueryParameter("exclude", excludeTags.state);
    builder.addQueryParameter("lang", this.mangaLang);
    return builder.build().toString();
  }

  // Filters
  override get supportsFilterFetching() {
    return false;
  }

  override getFilterList(data: unknown = null): FilterList {
    return [new ExcludeFilter(), ...super.getFilterList(data)];
  }

  protected override getSortOrderURIs(): [string, string][] {
    return [
      ["Relevance", "relevance"],
      ["Newest", "newest"],
      ["Most favorited", "most-favorited"],
      ["Most Liked", "most-liked"],
    ];
  }
}
