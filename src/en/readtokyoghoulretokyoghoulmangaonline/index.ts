// Port of keiyoushi/extensions-source src/en/readtokyoghoulretokyoghoulmangaonline/ReadTokyoGhoulReTokyoGhoulMangaOnline.kt
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadTokyoGhoulReTokyoGhoulMangaOnline extends MangaCatalog {
  override sourceList: [string, string][] = [
    ["Tokyo Ghoul", `${this.baseUrl}/manga/tokyo-ghoul/`],
    ["Tokyo Ghoul Jack", `${this.baseUrl}/manga/tokyo-ghoul-jack/`],
    ["Tokyo Ghoul: re Colored", `${this.baseUrl}/manga/tokyo-ghoulre-colored/`],
    ["Gorilla", `${this.baseUrl}/manga/this-gorilla-will-die-in-1-day/`],
    ["Zakki", `${this.baseUrl}/manga/tokyo-ghoul-zakki/`],
    ["Light Novel", `${this.baseUrl}/manga/tokyo-ghoul-re-light-novels/`],
    ["Choujin X", `${this.baseUrl}/manga/choujin-x/`],
    ["Tokyo Ghoul re", `${this.baseUrl}/manga/tokyo-ghoulre/`],
  ];
}
