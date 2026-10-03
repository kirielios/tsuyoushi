// Port of keiyoushi/extensions-source src/en/artlapsa/ArtLapsa.kt
import { MangasPage, Page, isNotBlank, parseAs, substringAfter, substringBefore, toHttpUrl, type Document, type Response } from "../../../sdk/index.ts";
import { Keyoapp } from "../../../themes/keyoapp/index.ts";

interface PageDto {
  path: string;
}

export default class ArtLapsa extends Keyoapp {
  override requestGeneres() {
    return this.client.get(`${this.baseUrl}/search`);
  }

  protected override parseGenres(document: Document) {
    return Object.fromEntries(document.select("[wire:model.live=genre] option:not(:contains(All))").map((it) => [it.text(), it.attr("value")]));
  }

  override searchUrlBuilder(query: string, page: number) {
    const b = toHttpUrl(`${this.baseUrl}/search`).newBuilder();
    if (page > 1) b.addQueryParameter("page", String(page));
    if (isNotBlank(query)) b.addQueryParameter("title", query);
    return b;
  }

  override searchMangaSelector() {
    return "main#main-content [wire:key*='serie']";
  }

  override parseSearchManga(response: Response): MangasPage {
    const document = response.asJsoup();
    const mangas = document.select(this.searchMangaSelector()).map((it) => this.searchMangaFromElement(it));
    return new MangasPage(mangas, mangas.length >= 20);
  }

  protected override altNameSelector = "div.font-medium:containsOwn(Alternative titles) ~ div span.select-all";
  protected override statusSelector = "[alt=Status]";
  protected override typeSelector = "[alt=Type]";

  protected override paidChapterSelector = "img[alt~=Coin], img[src*=star-circle]";

  override pageListParse(document: Document): Page[] {
    const xData = document.selectFirst("[x-data^=immersiveReader]")!.attr("x-data");
    const pagesJs = substringBefore(substringAfter(xData, "JSON.parse('", ""), "')");
    if (!pagesJs) throw new Error("Log in via WebView and purchase this chapter to read.");

    const pagesJson = parseAs<string>(`"${pagesJs}"`);
    return parseAs<PageDto[]>(pagesJson).map((page, i) => new Page(i, "", page.path));
  }
}
