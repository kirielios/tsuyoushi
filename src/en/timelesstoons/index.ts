// Port of keiyoushi/extensions-source src/en/timelesstoons/TimelessToons.kt
import { Keyoapp } from "../../../themes/keyoapp/index.ts";

export default class TimelessToons extends Keyoapp {
  override popularMangaSelector() {
    return "div:has(> h2:contains(Trending)) + div .group";
  }

  override latestUpdatesSelector() {
    return "div.grid > div.group.latest-poster";
  }
}
