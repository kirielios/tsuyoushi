// Port of keiyoushi/extensions-source src/id/manhwaindo/ManhwaIndo.kt
import { ClientBuilder, distinctBy, type Document, type Page, type Request } from "../../../sdk/index.ts";
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

export default class ManhwaIndo extends MangaThemesia {
  override mangaUrlDirectory = "/series";
  override hasProjectPage = true;

  protected override configureHeaders(h: Headers) {
    h.set("Accept-Language", "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7");
    return h;
  }

  protected override configureClient(b: ClientBuilder) {
    b.addInterceptor((request) => this.headersInterceptor(request));
    b.rateLimit(4);
    return b;
  }

  protected override pageListParse(document: Document): Page[] {
    return distinctBy(super.pageListParse(document), (it) => it.imageUrl!);
  }

  private headersInterceptor(request: Request): Request {
    const urlString = request.url;
    const newHeaders = new Headers(request.headers);
    newHeaders.delete("X-Requested-With");
    if (urlString.includes("gmbr.pro") || urlString.includes("manhwaindo.my")) {
      newHeaders.set("Sec-Fetch-Site", urlString.includes("manhwaindo.my") ? "same-origin" : "cross-site");
      newHeaders.set("Sec-Fetch-Mode", "no-cors");
      newHeaders.set("Sec-Fetch-Dest", "image");
    }

    const url = new URL(request.url);
    if (url.protocol === "http:" && (urlString.includes("gmbr.pro") || urlString.includes("manhwaindo.my"))) {
      url.protocol = "https:";
      return { ...request, url: url.href, headers: newHeaders };
    }
    return { ...request, headers: newHeaders };
  }
}
