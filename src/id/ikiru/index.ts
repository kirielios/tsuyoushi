// Port of keiyoushi/extensions-source src/id/ikiru/Ikiru.kt
import type { ClientBuilder } from "../../../sdk/index.ts";
import { NatsuId } from "../../../themes/natsuid/index.ts";

export default class Ikiru extends NatsuId {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(12, 3_000);
  }

  protected override transformJsonResponse(responseBody: string): string {
    const jsonStart = responseBody.search(/[{[]/);
    return jsonStart >= 0 ? responseBody.substring(jsonStart) : responseBody;
  }
}
