// Port of keiyoushi/extensions-source src/en/madaradex/MadaraDex.kt
import { ClientBuilder, toHex, toHttpUrl } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madara/index.ts";

export default class MadaraDex extends Madara {
  protected override configureHeaders(headers: Headers) {
    headers.set("sec-fetch-site", "same-site");
    return headers;
  }

  protected override mangaSubString = "title";
  protected override genreDirectory = "genre";

  private get siteUrl() {
    return this.baseUrl;
  }

  private randomHex16() {
    return toHex(crypto.getRandomValues(new Uint8Array(16)));
  }

  private async refreshAuth() {
    if (!this.client.cookieJar.loadForRequest(this.siteUrl).some((it) => it.name === "mdx_fp")) {
      // Cookie.Builder().domain("madaradex.org").path("/").expiresAt(now + 2592000000L)
      this.client.cookieJar.set(this.siteUrl, `mdx_fp=${this.randomHex16()}; Domain=madaradex.org; Path=/; Max-Age=2592000`);
    }
    try {
      const headers = this.headers;
      headers.set("Content-Type", "application/x-www-form-urlencoded");
      headers.set("X-Mdx-Auth-Refresh", "1");
      await this.client.execute({ url: `${this.baseUrl}/wp-admin/admin-ajax.php`, method: "POST", headers, body: "action=mdx_auth_refresh" });
    } catch {
      // runCatching
    }
  }

  protected override configureClient(b: ClientBuilder) {
    return b.addChainInterceptor(async (chain) => {
      const request = chain.request();
      if (request.headers.get("X-Mdx-Auth-Refresh") != null) {
        const headers = new Headers(request.headers);
        headers.delete("X-Mdx-Auth-Refresh");
        return chain.proceed({ ...request, headers });
      }
      const it = this.client.cookieJar.loadForRequest(this.siteUrl);
      if (!it.some((c) => c.name === "mdx_fp") || !it.some((c) => c.name === "mdx_auth")) await this.refreshAuth();
      const response = await chain.proceed(request);
      if (response.code === 403 && toHttpUrl(request.url).host === "cdn.madaradex.org") {
        await this.refreshAuth();
        return chain.proceed(request);
      }
      return response;
    });
  }
}
