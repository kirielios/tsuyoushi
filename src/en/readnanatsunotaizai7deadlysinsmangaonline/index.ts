// Port of keiyoushi/extensions-source src/en/readnanatsunotaizai7deadlysinsmangaonline/ReadNanatsuNoTaizai7DeadlySinsMangaOnline.kt
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadNanatsuNoTaizai7DeadlySinsMangaOnline extends MangaCatalog {
  override sourceList: [string, string][] = [
    ["Four Horsemen of the Apocalypse", `${this.baseUrl}/manga/four-horsemen-of-the-apocalypse/`],
    ["7DS: School", `${this.baseUrl}/manga/mayoe-nanatsu-no-taizai-gakuen/`],
    ["7DS:7 Days", `${this.baseUrl}/manga/nanatsu-no-taizai-seven-days/`],
    ["7DS:Vampires", `${this.baseUrl}/manga/nanatsu-no-taizai-vampires-of-edinburgh/`],
    ["Queen of Altar", `${this.baseUrl}/manga/the-queen-of-the-altar/`],
    ["7DS: 7 Colors", `${this.baseUrl}/manga/nanatsu-no-taizai-nanairo-no-tsuioku/`],
    ["7DS x FT", `${this.baseUrl}/manga/fairy-tail-x-nanatsu-no-taizai-christmas-special/`],
    ["Kongou Banchou", `${this.baseUrl}/manga/kongou-banchou/`],
    ["7DS:7 Scars", `${this.baseUrl}/manga/nanatsu-no-taizai-the-seven-scars-which-they-left-behind/`],
    ["7 Deadly Sins", `${this.baseUrl}/manga/nanatsu-no-taizai/`],
    ["Mokushiroku no Yonkishi", `${this.baseUrl}/manga/four-horsemen-of-the-apocalypse/`],
  ];
}
