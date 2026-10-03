// Port of keiyoushi/extensions-source src/en/culturedworks/CulturedWorks.kt
import { ClientBuilder, toHttpUrl, type Page } from "../../../sdk/index.ts";
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

export default class CulturedWorks extends MangaThemesia {
  protected override configureClient(b: ClientBuilder) {
    b.addInterceptor(this.acceptHeaderInterceptor());
    b.rateLimit(2);
    return b;
  }

  override seriesDetailsSelector = ".main-info";
  // base-class fields are initialised first, so this reads super.seriesStatusSelector
  override seriesStatusSelector: string = `.info-right .status, ${(this as MangaThemesia).seriesStatusSelector}`;
  override seriesGenreSelector = ".meta .genres .genre-item";

  override imageRequest(page: Page) {
    const host = toHttpUrl(page.imageUrl!).host;

    const headers = this.headersBuilder();
    headers.append("Host", host);
    // This doesn't load on the website, but removing referer seems to fix it
    if (host.includes("kumacdn")) {
      headers.delete("Referer");
    }

    return { url: page.imageUrl!, headers };
  }
}
