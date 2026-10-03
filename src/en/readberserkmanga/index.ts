// Port of keiyoushi/extensions-source src/en/readberserkmanga/ReadBerserkManga.kt
import { DateTimeFormatter, Locale, Page, SChapter, SManga, type Document, type Element } from "../../../sdk/index.ts";
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadBerserkManga extends MangaCatalog {
  override sourceList: [string, string][] = [
    ["Berserk", `${this.baseUrl}/manga/berserk/`],
    ["Guidebook", `${this.baseUrl}/manga/berserk-official-guidebook/`],
    ["Colored", `${this.baseUrl}/manga/berserk-colored/`],
    // ["Motion Comic", `${this.baseUrl}/manga/berserk-the-motion-comic/`], // Video
    ["Duranki", `${this.baseUrl}/manga/duranki/`],
    ["Gigantomakhia", `${this.baseUrl}/manga/gigantomakhia/`],
    ["Futatabi", `${this.baseUrl}/manga/futatabi/`],
    ["Berserk Spoilers & RAW", `${this.baseUrl}/manga/berserk-spoilers-raw/`],
  ];

  override mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.description = document.select("div.card-body > p").text();
    manga.title = document.select("h2 > span").text();
    manga.thumbnail_url = document.select(".card-img-right").attr("abs:src");
    return manga;
  }

  override chapterListSelector(): string {
    return "tbody > tr";
  }

  override chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.name = element.select("td:first-child").text();
    chapter.url = element.select("a.btn-primary").attr("abs:href");
    chapter.date_upload = dateFormat.tryParseDate(element.select("td:nth-child(2)").text());
    return chapter;
  }

  override pageListParse(document: Document): Page[] {
    return document.select("div.pages img.pages__img").map((element, index) => new Page(index, "", element.attr("abs:src")));
  }
}

const dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
