// Port of keiyoushi/extensions-source src/en/manhwaz/ManhwaZCom.kt
import { toHttpUrl, type ClientBuilder, type Element, type MangasPage } from "../../../sdk/index.ts";
import { ManhwaZ } from "../../../themes/manhwaz/index.ts";

export default class ManhwaZCom extends ManhwaZ {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(2);
  }

  // The original homepage popular slider (#slide-top) was removed by
  // the site, so the inherited selector returns nothing. Site is named
  // "ManhwaZ" and its dominant catalog is manhwa (57 pages vs 23 manga,
  // 43 manhua), so reuse the manhwa genre listing sorted by views.
  override async getPopularManga(page: number): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/genre/manhwa`).newBuilder().addQueryParameter("m_orderby", "views").addQueryParameter("page", String(page)).build();
    const response = await this.client.get(url.toString());
    return this.parseMangaPage(response, this.popularMangaSelector(), (it) => this.popularMangaFromElement(it));
  }

  protected override popularMangaSelector() {
    return this.latestUpdatesSelector();
  }

  protected override popularMangaFromElement(element: Element) {
    return this.latestUpdatesFromElement(element);
  }
}
