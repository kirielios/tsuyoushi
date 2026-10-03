// Port of keiyoushi/extensions-source src/en/onemangainfo/OneMangaInfo.kt
// Some chapters link to 1manga.co, hard to filter
import { MangaHub } from "../../../themes/mangahub/index.ts";

export default class OneMangaInfo extends MangaHub {
  override readonly mangaSource = "mh01";
}
