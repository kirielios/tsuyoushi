// Port of keiyoushi/extensions-source src/en/hentaixdickgirl/HentaiXDickgirl.kt
import type { Document, SManga } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madara/index.ts";

/** Mihon's UpdateStrategy; SManga here has no such field yet, so it rides along untyped for the host. */
const UpdateStrategy = { ALWAYS_UPDATE: 0, ONLY_FETCH_ONCE: 1 } as const;

export default class HentaiXDickgirl extends Madara {
  protected override parseDetails(document: Document, id: string, preserveUrl: string | null): SManga {
    return Object.assign(super.parseDetails(document, id, preserveUrl), { update_strategy: UpdateStrategy.ONLY_FETCH_ONCE });
  }
}
