// Port of keiyoushi/extensions-source src/id/shiyurasub/ShiyuraSub.kt
import { ZeistManga } from "../../../themes/zeistmanga/index.ts";

export default class ShiyuraSub extends ZeistManga {
  protected override hasFilters = true;
  protected override hasLanguageFilter = false;
  override get supportsLatest() {
    return false;
  }
  protected override mangaDetailsSelectorDescription = "#synopsis ~ p";
}
