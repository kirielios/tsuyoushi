// Port of keiyoushi/extensions-source src/all/kemono/Kemono.kt
import { Kemono as KemonoTheme } from "../../../themes/kemono/index.ts";

export default class Kemono extends KemonoTheme {
  override get getTypes() {
    return ["Patreon", "Pixiv Fanbox", "Discord", "Fantia", "Afdian", "Boosty", "Gumroad", "SubscribeStar"];
  }
}
