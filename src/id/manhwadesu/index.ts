// Port of keiyoushi/extensions-source src/id/manhwadesu/ManhwaDesu.kt
import { ClientBuilder, type Element } from "../../../sdk/index.ts";
import { MangaThemesia, clientHintsInterceptor } from "../../../themes/mangathemesia/index.ts";

export default class ManhwaDesu extends MangaThemesia {
  override mangaUrlDirectory = "/komik";

  protected override configureClient(b: ClientBuilder) {
    b.addInterceptor(clientHintsInterceptor);
    b.rateLimit(4);
    return b;
  }

  protected override imgAttr(element: Element): string {
    const attribs = (element.node as unknown as { attribs?: Record<string, string> }).attribs ?? {};
    const key = Object.keys(attribs).find((it) => it.endsWith("original-src"));
    if (key) return element.absUrl(key);

    if (element.hasAttr("data-lazy-src")) return element.attr("abs:data-lazy-src");
    if (element.hasAttr("data-src")) return element.attr("abs:data-src");
    return element.attr("abs:src");
  }
}
