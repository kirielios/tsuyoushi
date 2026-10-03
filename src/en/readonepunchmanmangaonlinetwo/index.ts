// Port of keiyoushi/extensions-source src/en/readonepunchmanmangaonlinetwo/ReadOnePunchManMangaOnlineTwo.kt
import { DateTimeFormatter, Locale, SChapter, SManga, distinctBy, substringAfter, type Document, type Element } from "../../../sdk/index.ts";
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadOnePunchManMangaOnlineTwo extends MangaCatalog {
  override sourceList: [string, string][] = distinctBy(
    ([
      ["One Punch Man", `${this.baseUrl}/manga/one-punch-man/`],
      ["Official", `${this.baseUrl}/manga/one-punch-man-official/`],
      ["Onepunch-Man (ONE)", `${this.baseUrl}/manga/onepunch-man-one/`],
      ["Colored", `${this.baseUrl}/manga/one-punch-man-colored/`],
      ["Mob Psycho 100", `${this.baseUrl}/manga/mob-psycho-100/`],
      ["Reigen", `${this.baseUrl}/manga/reigen/`],
      ["Versus (ONE)", `${this.baseUrl}/manga/versus/`],
      ["Bug Ego", `${this.baseUrl}/manga/bug-ego/`],
      ["Eyeshield 21", `${this.baseUrl}/manga/eyeshield-21/`],
    ] as [string, string][]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    (it) => it[1],
  );

  override mangaDetailsParse(document: Document): SManga {
    const manga = SManga.create();
    manga.description = document.select("div.card-body > p").text();
    manga.title = substringAfter(document.select("h2 > span").text(), "Manga: ").trim();
    manga.thumbnail_url = document.select(".card-img-right").attr("abs:src");
    return manga;
  }

  override chapterListSelector(): string {
    return "tbody > tr";
  }

  override chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.name = element.select("td:first-child").text();
    chapter.url = element.select("a").attr("abs:href");
    chapter.date_upload = dateFormat.tryParseDate(element.select("td:nth-child(2)").text());
    return chapter;
  }
}

const dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
