// Port of keiyoushi/extensions-source src/id/komikstation/KomikStation.kt
import { ClientBuilder, type Element, type SManga } from "../../../sdk/index.ts";
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

export default class KomikStation extends MangaThemesia {
  protected override configureClient(b: ClientBuilder) {
    return b.rateLimit(4);
  }

  override projectPageString = "/project-list";

  override hasProjectPage = true;

  override pageSelector = "div#readerarea img:not(noscript img)";

  protected override searchMangaFromElement(element: Element): SManga {
    const manga = super.searchMangaFromElement(element);
    const img = element.selectFirst("img.ts-post-image");
    if (img) manga.thumbnail_url = this.imgAttr(img);
    return manga;
  }
}
