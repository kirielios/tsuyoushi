// Port of keiyoushi/extensions-source src/id/soulscans/SoulScans.kt
import { LoneSeal, UrlLayout } from "../../../themes/loneseal/index.ts";

export default class SoulScans extends LoneSeal {
  protected override urlLayout = UrlLayout.LEGACY_COMIC;
  protected override includeProjectOnlyFilter = true;
  protected override get apiUrl() {
    return `${this.baseUrl}/api`;
  }
}
