// Port of keiyoushi/extensions-source lib/e4p/E4PManifestReader.kt
import { toHex, utf8 } from "../../sdk/crypto.ts";
import type { HttpUrl } from "../../sdk/httpurl.ts";
import { Page } from "../../sdk/models.ts";
import type { HttpClient } from "../../sdk/network.ts";
import { E4PDecoder } from "./decoder.ts";
import { EdrmVersion, decodeProtoPub, decodeTicket, type Link, type Variant } from "./dto.ts";

const imageHeightRegex = /^h(\d+)\//;

export class E4PManifestReader {
  private readonly decoder = new E4PDecoder();

  constructor(
    private readonly client: HttpClient,
    private readonly requestHeaders: Headers,
  ) {}

  async extractPagesFromEncryptedManifest(manifestUrl: HttpUrl): Promise<Page[]> {
    const ticketBytes = decodeTicket((await this.client.get(manifestUrl.toString(), this.requestHeaders)).bytes());
    const decoded = await this.decoder.decodeManifestFull(ticketBytes);
    const pub = decoded.pub;

    const consumerIdStr = (ticketBytes.consumer + "0".repeat(32)).substring(0, 32);
    const consumerId = utf8(consumerIdStr); // US_ASCII

    return this.mapPages(pub.spine, manifestUrl, (withAuth, bestVariant) => {
      const drm = bestVariant.image?.drm;
      const iv = drm?.iv;
      if (drm?.version === EdrmVersion.XEBP && iv != null && iv.length === 32 && decoded.pbexSeed != null && decoded.pbexSeed.length === 48) {
        // "\n"-joined upstream; see interceptor.ts for why the separator is encoded
        const xebpFragment = [withAuth.fragment ?? "", toHex(iv), encodeURIComponent(ticketBytes.contentId), toHex(consumerId), toHex(decoded.pbexSeed)].join("%0A");
        return withAuth.newBuilder().fragment(xebpFragment).build();
      }
      return withAuth;
    });
  }

  async extractPagesFromUnencryptedManifest(manifestUrl: HttpUrl): Promise<Page[]> {
    const pub = decodeProtoPub((await this.client.get(manifestUrl.toString(), this.requestHeaders)).bytes());
    return this.mapPages(pub.spine, manifestUrl, (withAuth) => withAuth);
  }

  private mapPages(spine: Link[], manifestUrl: HttpUrl, finalUrl: (withAuth: HttpUrl, bestVariant: Variant) => HttpUrl): Page[] {
    const manifestQueryNames = new Set(manifestUrl.toURL().searchParams.keys());
    const pages: Page[] = [];
    spine.forEach((link, index) => {
      const bestVariant = this.findBestVariant(link.variants);
      if (!bestVariant) return;

      const resolved = manifestUrl.resolve(bestVariant.link);
      if (!resolved) return;
      const builder = resolved.newBuilder();
      for (const name of manifestQueryNames) {
        const value = manifestUrl.queryParameter(name);
        if (value != null) builder.setQueryParameter(name, value);
      }
      pages.push(new Page(index, "", finalUrl(builder.build(), bestVariant).toString()));
    });
    return pages;
  }

  private findBestVariant(variants: Variant[]): Variant | null {
    let best: Variant | null = null;
    let bestHeight = -1;
    for (const it of variants.filter((v) => v.image != null)) {
      const h = Number.parseInt(imageHeightRegex.exec(it.link)?.[1] ?? "", 10) || 0;
      if (h > bestHeight) (best = it), (bestHeight = h);
    }
    return best;
  }
}
