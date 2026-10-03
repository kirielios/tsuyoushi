// Port of keiyoushi/extensions-source src/en/manhwanex/ManhwaNex.kt
import type { Host, Meta } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class ManhwaNex extends Madara {
  protected override chapterMode = ChapterMode.MangaAjax;

  constructor(host: Host, meta: Meta) {
    super(host, meta);
    // override val statusFilterOptions = super.statusFilterOptions + ...
    this.statusFilterOptions = [...this.statusFilterOptions, ["Upcoming", "upcoming"]];
  }
}
