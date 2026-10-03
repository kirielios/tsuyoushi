// Port of keiyoushi/extensions-source src/en/webtoonxyz/WebtoonXYZ.kt
import { DateTimeFormatter, Locale } from "../../../sdk/index.ts";
import { Madara } from "../../../themes/madara/index.ts";

export default class WebtoonXYZ extends Madara {
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US);
  protected override mangaSubString = "read";
  protected override genreDirectory = "webtoon-genre";
  protected override sendViewCount = false;

  private readonly thumbnailOriginalUrlRegex = /-\d+x\d+(\.[a-zA-Z]+)$/;

  protected override processThumbnail(url: string | null, _fromSearch = false): string | null {
    return url?.replace(this.thumbnailOriginalUrlRegex, "$1") ?? null;
  }
}
