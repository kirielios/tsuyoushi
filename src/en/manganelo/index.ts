// Port of keiyoushi/extensions-source src/en/manganelo/Manganato.kt
import type { SManga } from "../../../sdk/index.ts";
import { MangaBox } from "../../../themes/mangabox/index.ts";

const LEGACY_DOMAINS = ["https://chapmanganato.to/", "https://manganato.com/", "https://readmanganato.com/"];
const MIGRATE_MESSAGE = 'Migrate this entry from "Manganato" to "Manganato" to continue reading';

export default class Manganato extends MangaBox {
  override getMangaUrl(manga: SManga): string {
    if (LEGACY_DOMAINS.some((it) => manga.url.startsWith(it))) throw new Error(MIGRATE_MESSAGE);
    return super.getMangaUrl(manga);
  }
}
