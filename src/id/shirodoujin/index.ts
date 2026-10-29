// Port of keiyoushi/extensions-source src/id/shirodoujin/Shirodoujin.kt
import { DateTimeFormatter, Locale, SChapter, SManga, ago, urlWithoutDomain, type Document, type Element } from "../../../sdk/index.ts";
import { ZManga } from "../../../themes/zmanga/index.ts";

export default class Shirodoujin extends ZManga {
  protected override dateFormatter = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.forLanguageTag("id"));

  override hasProjectPage = true;

  // Not upstream (2026-10-29): the site's lists moved to flexbox4 cards, all results on one page.
  override popularMangaSelector() {
    return "div.flexbox4-item";
  }

  override popularMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    manga.url = urlWithoutDomain(element.select("div.flexbox4-content a").attr("abs:href"));
    manga.title = element.select("div.flexbox4-side .title").first()!.text();
    manga.thumbnail_url = element.select("img").attr("abs:src");
    return manga;
  }

  override mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.thumbnail_url = document.select("div.series-cover-card img").attr("abs:src");
    manga.author = document.select(".series-meta-item:contains(Author) span").text();
    manga.artist = document.select(".series-meta-item:contains(Artist) span").text();
    const status = document.select(".series-badges .status").first()?.ownText().toLowerCase() ?? "";
    manga.status = status.includes("ongoing") ? SManga.ONGOING : status.includes("completed") ? SManga.COMPLETED : SManga.UNKNOWN;
    manga.description = document.select("div.series-synopsis p").text();
    const genres = document.select("div.series-genres a").map((it) => it.text());
    const type = document.select(".series-badges .type").first()?.ownText();
    if (type && !genres.some((it) => it.toLowerCase() === type.toLowerCase())) genres.push(type);
    manga.genre = genres.join(", ");
    return manga;
  }

  override chapterListSelector() {
    return "ul[data-chapter-list] li a";
  }

  override chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.attr("abs:href"));
    chapter.name = element.select("strong").text();
    chapter.date_upload = this.parseRelativeDate(element.select("span").text());
    return chapter;
  }

  // "9mo ago", "3d ago", "2h ago"
  private parseRelativeDate(text: string): number {
    const m = /(\d+)\s*(y|mo|w|d|h|m|s)/.exec(text);
    if (!m) return 0;
    const units = { y: "years", mo: "months", w: "weeks", d: "days", h: "hours", m: "minutes", s: "seconds" } as const;
    return ago(Number(m[1]), units[m[2] as keyof typeof units]);
  }

  override async fetchFilterData(): Promise<unknown> {
    const document = (await this.client.get(`${this.baseUrl}/${this.searchPath}/`)).asJsoup();
    return document
      .select('.advanced-genre-options input[name="genre[]"]')
      .filter((it) => it.attr("value"))
      .map((element) => ({ id: element.attr("value"), name: element.nextElementSibling()?.text() ?? element.attr("value") }));
  }
}
