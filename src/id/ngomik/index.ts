// Port of keiyoushi/extensions-source src/id/ngomik/Ngomik.kt
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

export default class Ngomik extends MangaThemesia {
  private readonly userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.163 Safari/537.36";

  protected override configureHeaders(h: Headers) {
    h.set("User-Agent", this.userAgent);
    return h;
  }

  override projectPageString = "/pj";

  override hasProjectPage = true;
}
