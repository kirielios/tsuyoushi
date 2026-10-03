// Port of keiyoushi/extensions-source src/en/setsuscans/SetsuScans.kt
import { ClientBuilder, toHttpUrl, type Chain, type HttpUrlBuilder, type Response } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class SetsuScans extends Madara {
  protected override configureClient(b: ClientBuilder) {
    // addNetworkInterceptor: a request rewrite here
    b.addInterceptor((request) => {
      const url = toHttpUrl(request.url);
      if (url.host === "i0.wp.com") {
        const newUrl = url.newBuilder().removeAllQueryParameters("fit").build();

        return { ...request, url: newUrl.toString() };
      }

      return request;
    });
    b.addChainInterceptor((chain) => this.handleFailedImages(chain));
    b.rateLimit(2);
    return b;
  }

  private async handleFailedImages(chain: Chain): Promise<Response> {
    const response = await chain.proceed(chain.request());
    const url = toHttpUrl(response.url);
    if (url.host === "i0.wp.com" && response.code === 404) {
      const ssl = url.queryParameter("ssl");
      let newUrl: HttpUrlBuilder = url.newBuilder().removeAllQueryParameters("ssl");

      if (!ssl?.trim()) {
        newUrl = newUrl.addQueryParameter("ssl", "0");
      } else if (parseInt(ssl, 10) >= 5) {
        return response;
      } else if (parseInt(ssl, 10) === 0) {
        newUrl = newUrl.addQueryParameter("ssl", "2");
      } else if (parseInt(ssl, 10) >= 2) {
        newUrl = newUrl.addQueryParameter("ssl", String(parseInt(ssl, 10) + 1));
      }

      const newRequest = { ...chain.request(), url: newUrl.build().toString() };
      return this.client.execute(newRequest);
    }
    return response;
  }

  protected override chapterMode = ChapterMode.MangaAjax;

  protected override mangaDetailsSelectorStatus = "div.summary-heading:contains(status) + div.summary-content";
}
