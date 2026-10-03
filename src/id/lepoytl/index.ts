// Port of keiyoushi/extensions-source src/id/lepoytl/LepoyTL.kt
import { ZeistManga } from "../../../themes/zeistmanga/index.ts";

export default class LepoyTL extends ZeistManga {
  protected override popularMangaSelector = "div.PopularPosts div.grid > article";
  protected override popularMangaSelectorTitle = "h3 > a";
  protected override popularMangaSelectorUrl = "h3 > a";

  // =========================== Manga Details ============================
  protected override mangaDetailsSelector = "main";
  protected override mangaDetailsSelectorGenres = "aside dl a[rel=tag]";
  protected override mangaDetailsSelectorInfo = "#extra-info dl";
  protected override mangaDetailsSelectorInfoTitle = "dt";
  protected override mangaDetailsSelectorInfoDescription = "dd";

  // =============================== Pages ================================
  protected override pageListSelector = "#reader";
}
