// Port of keiyoushi/extensions-source src/en/mistscans/MistScans.kt
import { SManga, urlWithoutDomain, type Element } from "../../../sdk/index.ts";
import { Keyoapp } from "../../../themes/keyoapp/index.ts";

export default class MistScans extends Keyoapp {
  override popularMangaSelector() {
    return ".series-splide .splide__slide";
  }

  override popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const a = element.selectFirst("a[href]")!;
    manga.title = a.attr("title");
    manga.url = urlWithoutDomain(a.attr("abs:href"));
    manga.thumbnail_url = this.getElementImageUrl(element, "*[style*=background-image]") ?? undefined;
    return manga;
  }
}
