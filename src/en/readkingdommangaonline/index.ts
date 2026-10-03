// Port of keiyoushi/extensions-source src/en/readkingdommangaonline/ReadKingdomMangaOnline.kt
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadKingdomMangaOnline extends MangaCatalog {
  override sourceList: [string, string][] = [
    ["Kingdom", `${this.baseUrl}/manga/kingdom/`],
    ["Li Mu", `${this.baseUrl}/manga/li-mu/`],
    ["Meng Wu & Chu Zi", `${this.baseUrl}/manga/meng-wu-and-chu-zi-one-shot/`],
    // ["History Spoilers", `${this.baseUrl}/manga/kingdom-history-spoilers/`], // PDF
  ];
}
