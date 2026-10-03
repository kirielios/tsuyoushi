// Port of keiyoushi/extensions-source src/en/readblackclovermangaonline/ReadBlackCloverMangaOnline.kt
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadBlackCloverMangaOnline extends MangaCatalog {
  override sourceList: [string, string][] = [
    ["Black Clover", `${this.baseUrl}/manga/black-clover/`],
    ["Fan Colored", `${this.baseUrl}/manga/black-clover-colored/`],
    ["Hungry Joker", `${this.baseUrl}/manga/hungry-joker/`],
    ["Gaiden", `${this.baseUrl}/manga/black-clover-gaiden-quartet-knights/`],
  ];
}
