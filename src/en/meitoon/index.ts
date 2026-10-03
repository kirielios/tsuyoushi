// Port of keiyoushi/extensions-source src/en/meitoon/MeiToon.kt
import { Keyoapp } from "../../../themes/keyoapp/index.ts";

export default class MeiToon extends Keyoapp {
  override popularMangaSelector() {
    return ".series-splide .splide__slide:not(.splide__slide--clone)";
  }
}
