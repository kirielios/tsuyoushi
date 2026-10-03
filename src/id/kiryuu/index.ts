// Port of keiyoushi/extensions-source src/id/kiryuu/Kiryuu.kt
import type { ClientBuilder } from "../../../sdk/index.ts";
import { NatsuId } from "../../../themes/natsuid/index.ts";

export default class Kiryuu extends NatsuId {
  protected override configureClient(builder: ClientBuilder) {
    return builder.rateLimit(4);
  }

  protected override chapterListUrl(mangaId: string) {
    return super.chapterListUrl(mangaId).newBuilder().setQueryParameter("page", "1").build();
  }
}
