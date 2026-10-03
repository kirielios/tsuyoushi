// Port of keiyoushi/extensions-source src/id/komiktap/Komiktap.kt
import { ClientBuilder, Response } from "../../../sdk/index.ts";
import { MangaThemesia } from "../../../themes/mangathemesia/index.ts";

const IMG_CONTENT_TYPE = "image/jpeg";

export default class Komiktap extends MangaThemesia {
  protected override configureClient(b: ClientBuilder) {
    return b.addChainInterceptor(async (chain) => {
      const response = await chain.proceed(chain.request());
      const mime = response.header("Content-Type");
      if (response.isSuccessful) {
        if (mime !== "application/octet-stream") return response;
        // Fix image content type
        // ponytail: Response cannot list its headers, so the rebuilt one carries only Content-Type (enough for an image body)
        return new Response(this.host, { status: response.code, url: response.url, headers: { "content-type": IMG_CONTENT_TYPE }, body: response.bytes() });
      }
      return response;
    });
  }
}
