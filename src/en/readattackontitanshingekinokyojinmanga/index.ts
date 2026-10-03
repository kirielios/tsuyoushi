// Port of keiyoushi/extensions-source src/en/readattackontitanshingekinokyojinmanga/ReadAttackOnTitanShingekiNoKyojinManga.kt
import { SChapter, type Element } from "../../../sdk/index.ts";
import { MangaCatalog } from "../../../themes/mangacatalog/index.ts";

export default class ReadAttackOnTitanShingekiNoKyojinManga extends MangaCatalog {
  override sourceList: [string, string][] = [
    ["Shingeki No Kyojin", `${this.baseUrl}/manga/shingeki-no-kyojin/`],
    ["Colored", `${this.baseUrl}/manga/shingeki-no-kyojin-colored/`],
    ["Before the Fall", `${this.baseUrl}/manga/shingeki-no-kyojin-before-the-fall/`],
    ["Lost Girls", `${this.baseUrl}/manga/shingeki-no-kyojin-lost-girls/`],
    ["No Regrets", `${this.baseUrl}/manga/attack-on-titan-no-regrets/`],
    ["Junior High", `${this.baseUrl}/manga/attack-on-titan-junior-high/`],
    ["Guidebook", `${this.baseUrl}/manga/attack-on-titan-guidebook-inside-outside/`],
    ["Harsh Mistress", `${this.baseUrl}/manga/attack-on-titan-harsh-mistress-of-the-city/`],
    ["Anthology", `${this.baseUrl}/manga/attack-on-titan-anthology/`],
    ["Art Book", `${this.baseUrl}/manga/attack-on-titan-exclusive-art-book/`],
    ["Spoof", `${this.baseUrl}/manga/spoof-on-titan/`],
    ["No Regrets Colored", `${this.baseUrl}/manga/attack-on-titan-no-regrets-colored/`],
    ["BTF Light Novel", `${this.baseUrl}/manga/attack-on-titan-before-the-fall-light-novel/`],
    ["Best of SNK", `${this.baseUrl}/manga/the-best-of-attack-on-titan-in-color/`],
  ];

  override chapterListSelector(): string {
    return "div.w-full div.grid div.col-span-4";
  }

  override chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    const urlElement = element.selectFirst("a")!;
    const extra = element.selectFirst("div.text-xs")?.text();
    chapter.name = [urlElement.text(), extra ? extra : null].filter((it) => it != null).join(" - ");
    chapter.url = urlElement.attr("abs:href");
    return chapter;
  }
}
