// Port of keiyoushi/extensions-source src/en/omegascans/OmegaScans.kt
import { toHttpUrl, type ClientBuilder } from "../../../sdk/index.ts";
import { HeanCms } from "../../../themes/heancms/index.ts";

export default class OmegaScans extends HeanCms {
  protected override configureClient(builder: ClientBuilder) {
    const apiUrlHost = toHttpUrl(this.apiUrl).host;
    return builder.rateLimit(1, 1000, (it) => it.hostname === apiUrlHost);
  }

  protected override enableLogin = true;
}
