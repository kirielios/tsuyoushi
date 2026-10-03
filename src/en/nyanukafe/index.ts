// Port of keiyoushi/extensions-source src/en/nyanukafe/NyanuKafe.kt
import { Keyoapp } from "../../../themes/keyoapp/index.ts";

export default class NyanuKafe extends Keyoapp {
  override popularMangaSelector() {
    return ".series-splide .splide__slide:not(.splide__slide--clone)";
  }

  // Jsoup's :eq(n) is the element sibling index, i.e. :nth-child(n + 1); cheerio's :eq is a position in the result set
  protected override statusSelector = "div.w-full.flex-wrap > div:nth-child(4) > div:last-child";
  protected override authorSelector = "div.w-full.flex-wrap > div:nth-child(1) > div:last-child";
  protected override artistSelector = "div.w-full.flex-wrap > div:nth-child(2) > div:last-child";
  protected override typeSelector = "div.w-full.flex-wrap > div:nth-child(3) > div:last-child";
}
