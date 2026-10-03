// Port of keiyoushi/extensions-source src/en/readchainsawmanmangaonline/ReadChainsawManMangaOnline.kt
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadChainsawManMangaOnline extends MangaCatalog {
  override sourceList: [string, string][] = [
    ["Chainsaw Man", `${this.baseUrl}/manga/chainsaw-man/`],
    ["17-21", `${this.baseUrl}/manga/17-21-fujimoto-tatsuki-tanpenshuu/`],
    ["Fire Punch", `${this.baseUrl}/manga/fire-punch/`],
    ["Nayuta", `${this.baseUrl}/manga/yogen-no-nayuta/`],
    ["Look Back", `${this.baseUrl}/manga/look-back/`],
    ["Light Novel", `${this.baseUrl}/manga/chainsaw-man-buddy-stories/`],
    ["Colored", `${this.baseUrl}/manga/chainsaw-man-colored/`],
    ["Listen to Song", `${this.baseUrl}/manga/futsuu-ni-kiite-kure/`],
    ["Goodbye, Eri", `${this.baseUrl}/manga/sayonara-eri-goodbye-eri/`],
    ["22-26", `${this.baseUrl}/manga/22-26-fujimoto-tatsuki-tanpenshuu/`],
    ["Chainsaw Man Colored", `${this.baseUrl}/manga/chainsaw-man-colored/`],
    ["Chainsaw Man: Buddy Stories", `${this.baseUrl}/manga/chainsaw-man-buddy-stories/`],
  ];
}
