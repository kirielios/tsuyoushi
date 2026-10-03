// Port of keiyoushi/extensions-source src/id/ulascomic/UlasComic.kt
import { Page, substringAfter, type Document } from "../../../sdk/index.ts";
import { Status, Type, ZeistManga } from "../../../themes/zeistmanga/index.ts";

const IMAGE_REGEX = /"(https?:\/\/.*?)"/g;

export default class UlasComic extends ZeistManga {
  // Popular
  protected override popularMangaSelector = "div.serieslist.pop.wpop ul li";
  protected override popularMangaSelectorTitle = ".leftseries h2 a";
  protected override popularMangaSelectorUrl = ".leftseries h2 a";

  // Latest
  override latestUpdatesUrl(page: number, _orderBy: string | null = null): string {
    return super.latestUpdatesUrl(page, "updated");
  }

  // Filters
  protected override hasFilters = true;
  protected override hasLanguageFilter = false;

  protected override getStatusList(): Status[] {
    return [new Status("All", ""), new Status("Completed", "Completed"), new Status("Ongoing", "Ongoing")];
  }

  protected override getTypeList(): Type[] {
    return [new Type("All", ""), new Type("Manga", "Manga"), new Type("Manhua", "Manhua"), new Type("Manhwa", "Manhwa")];
  }

  // Details
  protected override mangaDetailsSelector = ".animefull";
  protected override mangaDetailsSelectorAuthor = "span[data-perfect-post='author']";
  protected override mangaDetailsSelectorDescription = ".wd-full p";
  protected override mangaDetailsSelectorGenres = ".mgen a";
  protected override mangaDetailsSelectorStatus = ".imptdt:contains(Status) i";

  protected override chapterCategory = "Manga Chapter";

  override pageListParse(document: Document): Page[] {
    // script:containsData(config['chapterImage'])
    const script = document.select("script").find((it) => it.data().includes("config['chapterImage']"));
    if (script != null) {
      const imageUrls = [...substringAfter(script.data(), "config['chapterImage']").matchAll(IMAGE_REGEX)].map((it) => it[1]);
      if (imageUrls.length) return imageUrls.map((url, i) => new Page(i, "", url));
    }
    return super.pageListParse(document);
  }
}
