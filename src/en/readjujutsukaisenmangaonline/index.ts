// Port of keiyoushi/extensions-source src/en/readjujutsukaisenmangaonline/ReadJujutsuKaisenMangaOnline.kt
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadJujutsuKaisenMangaOnline extends MangaCatalog {
  override sourceList: [string, string][] = [
    ["Jujutsu Kaisen", `${this.baseUrl}/manga/jujutsu-kaisen/`],
    ["Jujutsu Kaisen 0", `${this.baseUrl}/manga/jujutsu-kaisen-0/`],
    ["JJK Colored", `${this.baseUrl}/manga/jujutsu-kaisen-colored/`],
    ["Fan Scan", `${this.baseUrl}/manga/jujutsu-kaisen-fan-scan/`],
    ["JJK Light Novel", `${this.baseUrl}/manga/jujutsu-kaisen-first-light-novel/`],
    ["2nd Light Novel", `${this.baseUrl}/manga/jujutsu-kaisen-second-light-novel/`],
    ["No.9", `${this.baseUrl}/manga/no-9/`],
    ["Fanbook", `${this.baseUrl}/manga/jujutsu-kaisen-official-fanbook/`],
  ];
}
