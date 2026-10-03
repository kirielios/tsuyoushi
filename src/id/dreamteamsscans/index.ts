// Port of keiyoushi/extensions-source src/id/dreamteamsscans/DreamTeamsScans.kt
import { LoneSeal, UrlLayout } from "../../../themes/loneseal/index.ts";

export default class DreamTeamsScans extends LoneSeal {
  protected override urlLayout = UrlLayout.LEGACY_ROOT;
  protected override includeChapterTitle = true;
  protected override includeSeriesTagFilter = true;
  protected override get overloadedGenres(): Set<string> {
    return new Set([...super.overloadedGenres, "yaoi"]);
  }
}
