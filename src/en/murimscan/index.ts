// Port of keiyoushi/extensions-source src/en/murimscan/MurimScan.kt
import { ZeistManga } from "../../../themes/zeistmanga/index.ts";

export default class MurimScan extends ZeistManga {
  override get supportsLatest() {
    return false;
  }

  // Details
  protected override mangaDetailsSelector = "main";
  protected override mangaDetailsSelectorGenres = "dl.flex:contains(Genre) a[rel=tag], dl.flex:contains(Type) a[rel=tag]";
  protected override mangaDetailsSelectorInfo = "dl.flex";
  protected override mangaDetailsSelectorInfoTitle = "dt";
  protected override mangaDetailsSelectorInfoDescription = "dd";

  // Pages
  protected override pageListSelector = ".post-body, .check-box";
}
