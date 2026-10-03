// Port of keiyoushi/extensions-source src/id/otascans/OtaScans.kt
import { ClientBuilder, DateTimeFormatter, Locale, ZoneOffset, startOfDayUtc, toHttpUrl, type Document, type SManga } from "../../../sdk/index.ts";
import { ChapterMode, Madara } from "../../../themes/madara/index.ts";

export default class OtaScans extends Madara {
  protected override mangaSubString = "series";
  protected override archiveSelector() {
    return "div.manga__item";
  }
  protected override mangaDetailsSelectorTitle = "h1.post-title";
  protected override chapterMode = ChapterMode.MangaAjaxPaginated;
  protected override chapterDateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH);

  protected override configureClient(b: ClientBuilder) {
    return b.rateLimit(2, 1000, (it: URL) => !it.pathname.startsWith("/wp-content/uploads/"));
  }

  protected override parseArchive(document: Document): SManga[] {
    return document.select(this.archiveSelector()).flatMap((element) => {
      const link = element.selectFirst(this.archiveUrlSelector);
      if (!link) return [];
      const slug = toHttpUrl(link.attr("abs:href"))
        .pathSegments.filter((it) => it.trim())
        .pop();
      if (!slug) return [];
      const manga = this.archiveManga(element, slug);
      return manga ? [manga] : [];
    });
  }

  protected override parseChapterDate(date: string | null): number {
    const parsed = super.parseChapterDate(date);
    if (parsed !== 0) return parsed;

    const cleanDate = date?.trim();
    if (cleanDate == null) return 0;
    // DateTimeFormatterBuilder().appendPattern("d MMMM").parseDefaulting(YEAR, currentYear) upstream: append the year instead
    const parser = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH);
    const today = startOfDayUtc(0);
    const year = new Date(today).getUTCFullYear();
    const parsedDate = parser.tryParseDate(`${cleanDate} ${year}`, ZoneOffset.UTC);
    if (parsedDate === 0) return 0;
    return parsedDate > today ? parser.tryParseDate(`${cleanDate} ${year - 1}`, ZoneOffset.UTC) : parsedDate;
  }
}
