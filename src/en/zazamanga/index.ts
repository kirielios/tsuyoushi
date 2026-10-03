// Port of keiyoushi/extensions-source src/en/zazamanga/Zazamanga.kt
import type { Element, Page } from "../../../sdk/index.ts";
import { MadaraNoAjax } from "../../../themes/madara/index.ts";

export default class Zazamanga extends MadaraNoAjax {
  protected override chapterListSelector() {
    return "div.wp-manga-chapter";
  }

  override imageRequest(page: Page) {
    return { url: page.imageUrl!, headers: this.headers };
  }

  protected override imageFromElement(element: Element): string | null {
    if (element.hasAttr("data-src")) return element.attr("data-src");
    if (element.hasAttr("data-lazy-src")) return element.attr("data-lazy-src");
    if (element.hasAttr("srcset")) return this.getSrcSetImage(element.attr("srcset"));
    if (element.hasAttr("data-cfsrc")) return element.attr("data-cfsrc");
    return element.attr("src");
  }
}
