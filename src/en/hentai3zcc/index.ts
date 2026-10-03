// Port of keiyoushi/extensions-source src/en/hentai3zcc/Hentai3zCC.kt
import { SManga, urlWithoutDomain, type Element } from "../../../sdk/index.ts";
import { Manga18 } from "../../../themes/manga18/index.ts";

export default class Hentai3zCC extends Manga18 {
  protected override popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.selectFirst("a")!.absUrl("href"));
    manga.title = element.selectFirst("div.mg_info > div.mg_name a")!.text();
    manga.thumbnail_url = element.selectFirst("img")?.absUrl("src")?.replace("cover_thumb_2.webp", "cover_250x350.jpg")?.replace("admin.manga18.us", "bk.18porncomic.com");
    return manga;
  }
}
