// Port of keiyoushi/extensions-source src/id/crotpedia/CrotPedia.kt
import { DateTimeFormatter, Locale } from "../../../sdk/index.ts";
import { ZManga } from "../../../themes/zmanga/index.ts";

export default class CrotPedia extends ZManga {
  protected override dateFormatter = DateTimeFormatter.ofPattern("MMMM dd, yyyy", Locale.forLanguageTag("id"));

  override hasProjectPage = false;
}
