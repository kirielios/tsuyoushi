// Port of keiyoushi/extensions-source src/id/natsu/Natsu.kt
import type { ClientBuilder } from "../../../sdk/index.ts";
import { NatsuId } from "../../../themes/natsuid/index.ts";

export default class Natsu extends NatsuId {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(4);
  }
}
