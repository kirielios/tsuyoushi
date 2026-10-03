// Port of keiyoushi/extensions-source src/en/mangabat/Mangabat.kt
import type { SManga } from "../../../sdk/index.ts";
import { MangaBox } from "../../../themes/mangabox/index.ts";

const MIGRATE_MESSAGE = 'Migrate this entry from "Mangabat" to "Mangabat" to continue reading';

export default class Mangabat extends MangaBox {
  override getMangaUrl(manga: SManga): string {
    if (manga.url.includes("mangabat.com/")) throw new Error(MIGRATE_MESSAGE);
    return super.getMangaUrl(manga);
  }
}
