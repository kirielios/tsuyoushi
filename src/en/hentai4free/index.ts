// Port of keiyoushi/extensions-source src/en/hentai4free/Hentai4Free.kt
import { Page, parseAs, type Document, type Element } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madara/index.ts";

interface PageData {
  images?: { src: string }[];
}

export default class Hentai4Free extends Madara {
  protected override mangaSubString = "hentai";

  protected override archiveSelector() {
    return ".page-item-detail";
  }

  protected override postId(element: Element): string | null {
    const it = element
      .className()
      .split(/\s+/)
      .find((it) => it.startsWith("post-"));
    return it?.replace(/^post-/, "") ?? null;
  }

  protected override chapterListSelector() {
    return "section.h4f-oneshot-preview";
  }
  protected override chapterUrlSelector = ".h4f-preview-reader-btn";
  protected override chapterNameSelector = ".h4f-preview-title small";

  protected override async parsePages(document: Document): Promise<Page[]> {
    const pagesJson = document.selectFirst("#h4f-r2-data")?.data();
    if (pagesJson == null) return [];
    return (parseAs<PageData>(pagesJson).images ?? []).map((image, index) => new Page(index, "", image.src));
  }
}
