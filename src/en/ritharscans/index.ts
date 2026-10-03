// Port of keiyoushi/extensions-source src/en/ritharscans/RitharScans.kt
import { Page, isNotBlank, parseAs, toHttpUrl, trimEnd, trimStart, type Document, type Element } from "../../../sdk/index.ts";
import { Keyoapp } from "../../../themes/keyoapp/index.ts";

interface PageDto {
  path: string;
}

const CAN_READ_REGEX = /canRead\s*:\s*(true|false)/;
const BASE_LINK_REGEX = /baseLink\s*:\s*['"]([^'"]+)['"]/;

export default class RitharScans extends Keyoapp {
  override requestGeneres() {
    return this.client.get(`${this.baseUrl}/search`);
  }

  protected override parseGenres(document: Document) {
    return Object.fromEntries(document.select("[x-data*=genre] button").map((it) => [it.text(), it.attr("wire:key")]));
  }

  override searchUrlBuilder(query: string, _page: number) {
    const b = toHttpUrl(`${this.baseUrl}/search`).newBuilder();
    if (isNotBlank(query)) b.addQueryParameter("title", query);
    return b;
  }

  // Server-side
  override matchesGenres(_element: Element, _genres: string[]) {
    return true;
  }
  override matchesStatuses(_element: Element, _statuses: string[]) {
    return true;
  }

  override searchMangaSelector() {
    return "[wire:snapshot*=pages.search] button[tags]";
  }

  protected override altNameSelector = "div.font-medium:containsOwn(Alternative titles) ~ div span.select-all";
  protected override statusSelector = "[alt=Status]";
  protected override typeSelector = "[alt=Type]";

  protected override paidChapterSelector = "img[alt~=Coin], img[src*=star-circle]";

  override pageListParse(document: Document): Page[] {
    const xData = document.selectFirst("[x-data*=immersiveReader]")?.attr("x-data");
    if (xData == null) return super.pageListParse(document);

    const canRead = CAN_READ_REGEX.exec(xData)?.[1] === "true";
    if (!canRead) throw new Error("This chapter is locked. Log in via WebView and unlock this chapter to read.");

    const baseLink = BASE_LINK_REGEX.exec(xData)?.[1] ?? `${this.baseUrl}/storage/`;
    const pagesJson = this.extractPagesJson(xData);
    if (pagesJson == null) throw new Error("Failed to parse chapter pages");

    const pages = parseAs<PageDto[]>(pagesJson);
    if (!pages.length) throw new Error("This chapter is locked. Log in via WebView and unlock this chapter to read.");

    return pages.map((page, i) => {
      const imageUrl = page.path.startsWith("http://") || page.path.startsWith("https://") ? page.path : `${trimEnd(baseLink, "/")}/${trimStart(page.path, "/")}`;
      return new Page(i, document.location(), imageUrl);
    });
  }

  private extractPagesJson(xData: string): string | null {
    const startIndex = xData.indexOf("pages:");
    if (startIndex === -1) return null;
    const afterPages = xData.substring(startIndex + 6).trimStart();
    if (!afterPages.startsWith("[")) return null;

    let depth = 0;
    for (let i = 0; i < afterPages.length; i++) {
      if (afterPages[i] === "[") depth++;
      else if (afterPages[i] === "]") {
        depth--;
        if (depth === 0) return afterPages.substring(0, i + 1);
      }
    }
    return null;
  }

  override getTypeList(): Record<string, string> {
    return {};
  }
}
