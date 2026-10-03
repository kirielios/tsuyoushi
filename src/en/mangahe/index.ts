// Port of keiyoushi/extensions-source src/en/mangahe/MangaHe.kt
import type { Document, Page } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madara/index.ts";

export default class MangaHe extends Madara {
  protected override async parsePages(document: Document): Promise<Page[]> {
    return (await super.parsePages(document)).filter((page, idx) => !(idx === 0 && page.imageUrl?.endsWith("/1-000001.jpg") === true));
  }
}
