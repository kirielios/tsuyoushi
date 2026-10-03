// Port of keiyoushi/extensions-source src/en/readsololevelingmangamanhwaonline/ReadSoloLevelingMangaManhwaOnline.kt
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadSoloLevelingMangaManhwaOnline extends MangaCatalog {
  override sourceList: [string, string][] = [
    ["Solo Leveling Manhwa", `${this.baseUrl}/manga/solo-leveling/`],
    ["Solo Leveling Light Novel", `${this.baseUrl}/manga/solo-leveling-light-novel/`],
    // ["Audio book", `${this.baseUrl}/manga/solo-leveling-audiobook/`], // Audio
    ["Solo Leveling : Ragnarok", `${this.baseUrl}/manga/solo-leveling-ragnarok/`],
    ["SL: Ragnarok Novel", `${this.baseUrl}/manga/solo-leveling-ragnarok-novel/`],
  ];
}
