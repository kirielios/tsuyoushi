// Port of keiyoushi/extensions-source src/id/okyykomik/OkyyKomik.kt
import { ZeistManga } from "../../../themes/zeistmanga/index.ts";

export default class OkyyKomik extends ZeistManga {
  protected override mangaDetailsSelector = "#Blog1";
  protected override mangaDetailsSelectorAuthor = "#extra-info > dl:nth-child(2) dd";
  protected override mangaDetailsSelectorArtist = "#extra-info > dl:nth-child(3) dd";
  protected override pageListSelector = "article div.separator";
  override get supportsLatest() {
    return false;
  }
}
