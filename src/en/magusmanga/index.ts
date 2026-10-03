// Port of keiyoushi/extensions-source src/en/magusmanga/MagusManga.kt
import { toHttpUrl, type ClientBuilder } from "../../../sdk/index.ts";
import { Iken } from "../../../themes/iken/index.ts";

export default class MagusManga extends Iken {
  private get baseUrlHost() {
    return toHttpUrl(this.baseUrl).host;
  }

  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(1, 1000, (it) => it.hostname === this.baseUrlHost);
  }

  protected override sortPagesByFilename = true;
}
