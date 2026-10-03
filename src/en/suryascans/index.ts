// Port of keiyoushi/extensions-source src/en/suryascans/GenzToons.kt
import type { ClientBuilder } from "../../../sdk/index.ts";
import { Keyoapp } from "../../../themes/keyoapp/index.ts";

export default class GenzToons extends Keyoapp {
  protected override configureClient(builder: ClientBuilder) {
    return builder.connectTimeout(90_000).readTimeout(90_000).rateLimit(3);
  }

  override getPopularManga(page: number) {
    return this.getSearchMangaList(page, "", []);
  }
}
