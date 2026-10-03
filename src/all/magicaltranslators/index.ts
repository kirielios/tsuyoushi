// Port of keiyoushi/extensions-source src/all/magicaltranslators/MagicalTranslators.kt
import { MangasPage } from "../../../sdk/index.ts";
import { Guya } from "../../../themes/guya/index.ts";

export default class MagicalTranslators extends Guya {
  protected override filterMangas(mangasPage: MangasPage): MangasPage {
    switch (this.lang) {
      case "en":
        return new MangasPage(
          mangasPage.mangas.filter((it) => !(it.url.endsWith("-ES") || it.url.endsWith("-PL"))),
          mangasPage.hasNextPage,
        );
      case "es":
        return new MangasPage(
          mangasPage.mangas.filter((it) => it.url.endsWith("-ES")),
          mangasPage.hasNextPage,
        );
      case "pl":
        return new MangasPage(
          mangasPage.mangas.filter((it) => it.url.endsWith("-PL")),
          mangasPage.hasNextPage,
        );
      default:
        throw new Error(`Unknown language: ${this.lang}`);
    }
  }
}
