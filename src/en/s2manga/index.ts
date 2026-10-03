// Port of keiyoushi/extensions-source src/en/s2manga/S2Manga.kt
import type { Element } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madara/index.ts";

export default class S2Manga extends Madara {
  protected override imageFromElement(element: Element): string | null {
    return super.imageFromElement(element)?.trim() ?? null;
  }
}
