// Port of keiyoushi/extensions-source src/en/mangamirai/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class CheckFilter extends Filter.CheckBox {}

export class SelectFilter extends Filter.Select<string> {
  constructor(displayName: string, private readonly vals: [string, string][]) {
    super(displayName, vals.map((it) => it[0]));
  }
  get value(): string {
    return this.vals[this.state][1];
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort by", [
      ["Newest", "new"],
      ["Ranking", "ranking"],
    ]);
  }
}

export class GenreFilter extends SelectFilter {
  constructor() {
    super("Genres", [
      ["All", ""],
      ["Action", "Action"],
      ["Fantasy", "Fantasy"],
      ["Romance", "Romance"],
      ["Drama", "Drama"],
      ["Horror", "Horror"],
      ["Suspense", "Suspense"],
      ["Mystery", "Mystery"],
      ["Sports", "Sports"],
      ["Slice of Life", "Slice of Life"],
      ["Boys Love", "Boys Love"],
      ["Girls Love", "Girls Love"],
      ["Sci-Fi", "Sci-Fi"],
      ["Gourmet", "Gourmet"],
      ["Historical", "Historical"],
      ["Comedy", "Comedy"],
      ["Other", "Other"],
    ]);
  }
}

export class TagFilter extends Filter.Group<CheckFilter> {
  constructor() {
    super("Tags", [
      new CheckFilter("Free"),
      new CheckFilter("On Sale"),
      new CheckFilter("New"),
      new CheckFilter("Completed"),
      new CheckFilter("Manga"),
      new CheckFilter("V-scroll Manga"),
      new CheckFilter("Chapter"),
    ]);
  }
}

export class AuthorFilter extends Filter.Group<CheckFilter> {
  constructor() {
    super("Authors", [
      new CheckFilter("Abigail Blackman"),
      new CheckFilter("Lys Blakeslee"),
      new CheckFilter("Phil Christie"),
      new CheckFilter("Alexis Eckerman"),
      new CheckFilter("Rochelle Gancio"),
      new CheckFilter("Bianca Pistillo"),
      new CheckFilter("Chiho Christie"),
      new CheckFilter("Stephen Paul"),
      new CheckFilter("Rachel Pierce"),
      new CheckFilter("Taylor Engel"),
      new CheckFilter("Alethea Nibley"),
      new CheckFilter("Athena Nibley"),
      new CheckFilter("Katie Blakeslee"),
      new CheckFilter("Amanda Haley"),
      new CheckFilter("Caleb Cook"),
      new CheckFilter("Kevin Gifford"),
      new CheckFilter("Ryukishi07"),
      new CheckFilter("Junji Ito"),
      new CheckFilter("Leighann Harvey"),
      new CheckFilter("Reki Kawahara"),
      new CheckFilter("CLAMP"),
      new CheckFilter("Rachel J. Pierce"),
      new CheckFilter("Carolina Hdz"),
      new CheckFilter("Eleanor Summers"),
      new CheckFilter("Sheldon Drzka"),
      new CheckFilter("Dayeun kim"),
      new CheckFilter("Elena Pizarro Lanzas"),
      new CheckFilter("Shigeru Tsuchiyama"),
      new CheckFilter("Hiro Mashima"),
      new CheckFilter("Adnazeer Macalangcom"),
      new CheckFilter("Andrew Cunningham"),
      new CheckFilter("Ko Ransom"),
      new CheckFilter("Brandon Bovia"),
      new CheckFilter("John Neal"),
      new CheckFilter("Magica Magica Quartet"),
      new CheckFilter("Akira Toriyama"),
      new CheckFilter("Arbash Mughal"),
      new CheckFilter("Jan Cash"),
      new CheckFilter("William Flanagan"),
      new CheckFilter("Erin Hickman"),
      new CheckFilter("Ivo Marques"),
      new CheckFilter("Madeleine Jose"),
      new CheckFilter("Ajani Oloye"),
      new CheckFilter("Akane Shimizu"),
      new CheckFilter("Alexandra McCullough-Garcia"),
      new CheckFilter("Alice Prowse"),
      new CheckFilter("Rumiko Takahashi"),
      new CheckFilter("abec"),
      new CheckFilter("Arina Tanemura"),
      new CheckFilter("Christine Dashiell"),
      new CheckFilter("Hajime Isayama"),
      new CheckFilter("AndWorld AndWorld Design"),
      new CheckFilter("Anthony Quintessenza"),
      new CheckFilter("Ema Toyama"),
      new CheckFilter("Emma Schumacker"),
      new CheckFilter("Fujino Omori"),
      new CheckFilter("Giuseppe di Martino"),
      new CheckFilter("Jenny McKeon McKeon"),
      new CheckFilter("Julie Goniwich"),
      new CheckFilter("Masashi Kishimoto"),
      new CheckFilter("Tsutomu Nihei"),
      new CheckFilter("Amber Tamosaitis"),
      new CheckFilter("Amethyst Xuan"),
      new CheckFilter("Andria McKnight"),
      new CheckFilter("Arata Shiraishi"),
      new CheckFilter("Hirohiko Araki"),
      new CheckFilter("Hiroyuki Takei"),
      new CheckFilter("Kafka Asagiri"),
      new CheckFilter("Kaori Yuki"),
      new CheckFilter("Kazuki Takahashi"),
      new CheckFilter("Kei Coffman"),
      new CheckFilter("Natsume Ono"),
      new CheckFilter("Sango Harukawa"),
      new CheckFilter("Shuzo Oshimi"),
      new CheckFilter("Suzuhito Yasuda"),
      new CheckFilter("Takeshi Obata"),
      new CheckFilter("Aila Nagamine"),
      new CheckFilter("Hitoshi Iwaaki"),
      new CheckFilter("Homura Kawamoto"),
      new CheckFilter("Keji Mizoguchi"),
      new CheckFilter("Ken Akamatsu"),
      new CheckFilter("Noboru Akimoto"),
      new CheckFilter("Paul Starr"),
      new CheckFilter("Ryohgo Narita"),
      new CheckFilter("Shinkoshoto"),
      new CheckFilter("Tomo Kimura"),
      new CheckFilter("Yuu Watase"),
      new CheckFilter("Aki"),
      new CheckFilter("Akiko Higashimura"),
      new CheckFilter("Akira Kanbe"),
      new CheckFilter("Andrew Gaippe"),
      new CheckFilter("Boichi"),
      new CheckFilter("Chana Conley"),
      new CheckFilter("Christina Rose"),
      new CheckFilter("Eiichiro Oda"),
      new CheckFilter("Fuse"),
      new CheckFilter("Inio Asano"),
      new CheckFilter("Jasmine Bernhardt"),
      new CheckFilter("Jocelyne Allen"),
      new CheckFilter("Kaoru Mori"),
    ]);
  }
}

export class PublisherFilter extends SelectFilter {
  constructor() {
    super("Publishers", [
      ["All", ""],
      ["Yen Press", "Yen Press"],
      ["Kodansha USA Publishing LLC", "Kodansha USA Publishing LLC"],
      ["VIZ Media LLC", "VIZ Media LLC"],
      ["Manga UP!", "Manga UP!"],
      ["One Peace Books, Inc.", "One Peace Books, Inc."],
      ["J-Novel Club", "J-Novel Club"],
      ["NIHONBUNGEISHA Co.,Ltd.", "NIHONBUNGEISHA Co.,Ltd."],
      ["Shusuisha inc.", "Shusuisha inc."],
      ["Coamix Inc.", "Coamix Inc."],
      ["TORICO Co., Ltd.", "TORICO Co., Ltd."],
      ["Animate International Co., Ltd.", "Animate International Co., Ltd."],
      ["AKITASHOTEN Co., Ltd.", "AKITASHOTEN Co., Ltd."],
      ["Futabasha Publishers LTD.", "Futabasha Publishers LTD."],
      ["YUZU comics", "YUZU comics"],
      ["weavin", "weavin"],
      ["Cork", "Cork"],
      ["Jitsugyo no Nihon Sha, Ltd.", "Jitsugyo no Nihon Sha, Ltd."],
      ["No.9 Inc.", "No.9 Inc."],
      ["TO BOOKS, Inc", "TO BOOKS, Inc"],
      ["EARTH STAR Entertainment", "EARTH STAR Entertainment"],
      ["HykeComic", "HykeComic"],
      ["SHUFU TO SEIKATSU SHA CO.,LTD.", "SHUFU TO SEIKATSU SHA CO.,LTD."],
      ["HERO’S INC", "HERO’S INC"],
      ["Kaoru Tada/minato-pro,M'z-plan", "Kaoru Tada/minato-pro,M'z-plan"],
      ["COMPASS Inc.", "COMPASS Inc."],
      ["Manga Box Co., Ltd.", "Manga Box Co., Ltd."],
    ]);
  }
}

/** HttpUrl.Builder.addFilter */
export const addFilter = (url: URL, param: string, filter: CheckFilter) => {
  if (filter.state) url.searchParams.append(param, filter.name);
};
