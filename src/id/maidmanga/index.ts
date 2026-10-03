// Port of keiyoushi/extensions-source src/id/maidmanga/MaidManga.kt
import { DateTimeFormatter, Locale } from "../../../sdk/index.ts";
import { ZManga } from "../../../themes/zmanga/index.ts";

export default class MaidManga extends ZManga {
  protected override dateFormatter = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.forLanguageTag("id"));

  override hasProjectPage = true;
}
