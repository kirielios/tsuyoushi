// Port of keiyoushi/extensions-source src/en/topmanhuafan/TopManhuaFan.kt
import { DateTimeFormatter, Locale, type Page } from "../../../sdk/index.ts";
import { MadaraNoAjax } from "../../../themes/madara/index.ts";

export default class TopManhuaFan extends MadaraNoAjax {
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("MM/dd/yyyy", Locale.ENGLISH);
  protected override mangaSubString = "manhua";

  protected override chapterListSelector() {
    return "div.wp-manga-chapter";
  }

  override imageRequest(page: Page) {
    return { url: page.imageUrl!, headers: this.headers };
  }
}
