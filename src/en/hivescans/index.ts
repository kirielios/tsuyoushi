// Port of keiyoushi/extensions-source src/en/hivescans/HiveScans.kt
import type { Page } from "../../../sdk/index.ts";
import { Iken } from "../../../themes/iken/index.ts";

export default class HiveScans extends Iken {
  override imageRequest(page: Page) {
    const headers = new Headers(this.headers);
    headers.set("Cache-Control", "no-cache"); // CacheControl.Builder().noCache()
    return { url: page.imageUrl!, headers };
  }
}
