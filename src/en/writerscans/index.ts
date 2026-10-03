// Port of keiyoushi/extensions-source src/en/writerscans/WriterScans.kt
import { Keyoapp } from "../../../themes/keyoapp/index.ts";

export default class WriterScans extends Keyoapp {
  override popularMangaSelector() {
    return "div:contains(Trending) + div .group.overflow-hidden";
  }
}
