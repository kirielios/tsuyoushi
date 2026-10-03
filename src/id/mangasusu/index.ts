// Port of keiyoushi/extensions-source src/id/mangasusu/Mangasusu.kt
import { ClientBuilder, type Chain, type Response } from "../../../sdk/index.ts";
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

export default class Mangasusu extends MangaThemesia {
  override mangaUrlDirectory = "/komik";

  protected override configureClient(b: ClientBuilder) {
    return b.addChainInterceptor((chain) => this.sucuriInterceptor(chain));
  }

  // Taken from es/ManhwasNet
  private async sucuriInterceptor(chain: Chain): Promise<Response> {
    const request = chain.request();
    const url = request.url;
    let response: Response;
    try {
      response = await chain.proceed(request);
    } catch {
      // Try to clear cookies and retry
      this.client.cookieJar.saveFromResponse(url, []);
      const clearHeaders = new Headers(request.headers);
      clearHeaders.delete("Cookie");
      response = await chain.proceed({ ...request, headers: clearHeaders });
    }
    if (!response.header("x-sucuri-cache") && response.header("x-sucuri-id") != null && url.startsWith(this.baseUrl)) {
      // Not ported: upstream evaluates the challenge script in QuickJS, a sandbox. Here it would run the site's code
      // with the app server's privileges, so the challenge stays unsolved until the host offers a sandboxed evaluator.
      throw new Error("Situs yang dilindungi - Buka di WebView untuk mencoba membuka blokir.");
    }
    return response;
  }
}
