// Port of keiyoushi/extensions-source src/id/komikindo/Komikindo.kt
import { ClientBuilder, toHttpUrlOrNull, type Document, type SManga } from "../../../sdk/index.ts";
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

export default class Komikindo extends MangaThemesia {
  // Some covers fail to load with no Accept header + no resize parameter.
  // Hence the workarounds:

  protected override configureClient(b: ClientBuilder) {
    b.addInterceptor(this.acceptHeaderInterceptor());
    b.rateLimit(3);
    return b;
  }

  protected override mangaDetailsParse(document: Document): SManga {
    const manga = super.mangaDetailsParse(document);
    const url = toHttpUrlOrNull(manga.thumbnail_url);
    // setEncodedQueryParameter: the comma stays unencoded
    manga.thumbnail_url = url && url.queryParameter("resize") == null ? `${url}${url.encodedQuery ? "&" : "?"}resize=165,225` : undefined;
    return manga;
  }

  override hasProjectPage = true;
}
