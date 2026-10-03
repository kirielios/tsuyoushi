// Port of keiyoushi/extensions-source src/en/omoi/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class SelectFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  get value(): string {
    return this.vals[this.state][1];
  }
}

export class CheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort by", [
      ["Popular", "popular"],
      ["Recent Series", "recent_series"],
      ["Alphabetical", "alphabetical"],
    ]);
  }
}

export class AccessTypeFilter extends SelectFilter {
  constructor() {
    super("Access Type", [
      ["Any", ""],
      ["Partial Premium", "premium_including_partial"],
      ["Premium", "fully_premium"],
      ["Ebook", "purchasable"],
    ]);
  }
}

export class PublisherFilter extends SelectFilter {
  constructor() {
    super("Publisher", [
      ["Any", ""],
      ["ABLAZE", "ablaze"],
      ["C'moA Comics", "cmoa-comics"],
      ["CLLENN", "cllenn"],
      ["Coamix Inc.", "coamix"],
      ["COMIC ROOM Co., Ltd.", "comic-room-co-ltd"],
      ["COMPASS Inc.", "compass-inc"],
      ["CORK", "cork"],
      ["FUNGUILD (MangaPlaza)", "funguild-mangaplaza"],
      ["Futabasha Publishers Ltd.", "futabasha-publishers-ltd"],
      ["Futabasha Publishers LTD. (MangaPlaza)", "futabasha-publishers-ltd-mangaplaza"],
      ["Glacier Bay Books", "glacier-bay-books"],
      ["honcomi", "honcomi"],
      ["J-Novel Club", "j-novel-club"],
      ["KADOKAWA", "kadokawa"],
      ["Kaiten Books", "kaiten-books"],
      ["Kaoru Tada/M'z plan/Minato Pro", "kaoru-tada-mz-plan-minato-pro"],
      ["Kodansha", "kodansha"],
      ["Libre Inc.", "libre-inc"],
      ["Manga Box Co., Ltd.", "manga-box-co-ltd"],
      ["Manga Mavericks Books", "manga-mavericks-books"],
      ["Manga Up!", "manga-up"],
      ["Omoi", "azuki"],
      ["One Peace Books", "one-peace-books"],
      ["PICK UP PRESS", "pick-up-press"],
      ["Red String Translations", "red-string-translations"],
      ["RIDEON", "rideon"],
      ["SHODENSHA Publishing CO., LTD.", "shodensha-publishing-co-ltd"],
      ["SHUFU TO SEIKATSU SHA", "shufu-to-seikatsu-sha"],
      ["SOZO Comics", "sozo-comics"],
      ["Star Fruit Books", "star-fruit-books"],
      ["TAIYOHTOSHO Co., Ltd.", "taiyohtosho-co-ltd"],
      ["Toii Games (MediBang!)", "toii-games-medibang"],
      ["TORICO (MediBang!)", "torico-medibang"],
      ["Unknown", "unknown"],
      ["VAST Visual", "vast-visual"],
      ["Voltage Inc.", "voltage"],
      ["YUZU Comics", "yuzu-comics"],
    ]);
  }
}

export class GenreFilter extends Filter.Group<CheckBox> {
  constructor() {
    super("Genres", [
      new CheckBox("Action", "action"),
      new CheckBox("Adventure", "adventure"),
      new CheckBox("Comedy", "comedy"),
      new CheckBox("Drama", "drama"),
      new CheckBox("Ecchi", "ecchi"),
      new CheckBox("Fantasy", "fantasy"),
      new CheckBox("Harem", "harem"),
      new CheckBox("Historical", "historical"),
      new CheckBox("Horror", "horror"),
      new CheckBox("Josei", "josei"),
      new CheckBox("Martial Arts", "martial-arts"),
      new CheckBox("Mature", "mature"),
      new CheckBox("Mecha", "mecha"),
      new CheckBox("Mystery", "mystery"),
      new CheckBox("Psychological", "psychological"),
      new CheckBox("Romance", "romance"),
      new CheckBox("School Life", "school-life"),
      new CheckBox("Sci-Fi", "scifi"),
      new CheckBox("Seinen", "seinen"),
      new CheckBox("Shojo", "shoujo"),
      new CheckBox("Shonen", "shounen"),
      new CheckBox("Slice of Life", "slice-of-life"),
      new CheckBox("Sports", "sports"),
      new CheckBox("Supernatural", "supernatural"),
      new CheckBox("Tragedy", "tragedy"),
    ]);
  }
}
