// Port of keiyoushi/extensions-source src/id/narasininja/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class StatusFilter extends Filter.Select<string> {
  private readonly options = ["", "ongoing", "completed", "hiatus"];
  constructor() {
    super("Status", ["All", "Ongoing", "Completed", "Hiatus"]);
  }
  selectedValue() {
    return this.options[this.state];
  }
}

export class TypeFilter extends Filter.Select<string> {
  private readonly options = ["", "manga", "manhwa", "manhua", "comic", "novel"];
  constructor() {
    super("Type", ["All", "Manga", "Manhwa", "Manhua", "Comic", "Novel"]);
  }
  selectedValue() {
    return this.options[this.state];
  }
}

export class OrderFilter extends Filter.Select<string> {
  private readonly options = ["update", "added", "title", "titlereverse"];
  constructor() {
    super("Order", ["Update", "Added", "A-Z", "Z-A"]);
  }
  selectedValue() {
    return this.options[this.state];
  }
}

export class GenreCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

// Upstream shares one GENRES list between filter lists; fresh boxes per GenreFilter keep states apart.
export class GenreFilter extends Filter.Group<GenreCheckBox> {
  constructor() {
    super(
      "Genre",
      GENRES.map(([name, value]) => new GenreCheckBox(name, value)),
    );
  }
}

const GENRES: [string, string][] = [
  ["4-Koma", "92"],
  ["Action", "2"],
  ["Adaptation", "74"],
  ["Adult", "67"],
  ["Adventure", "3"],
  ["Animals", "117"],
  ["Anthology", "158"],
  ["Antihero", "125"],
  ["apocalypse", "87"],
  ["Award Winning", "149"],
  ["Beasts", "97"],
  ["Bodyswap", "132"],
  ["Boys' Love", "94"],
  ["Bully", "114"],
  ["Cartoon", "133"],
  ["Childhood Friends", "113"],
  ["Comedy", "4"],
  ["Comic", "78"],
  ["Cooking", "5"],
  ["Crime", "6"],
  ["Crossdressing", "62"],
  ["Dance", "146"],
  ["Dark Fantasy", "105"],
  ["Delinquent", "115"],
  ["Delinquents", "91"],
  ["Dementia", "134"],
  ["Demon", "64"],
  ["Demons", "8"],
  ["Doujinshi", "119"],
  ["Drama", "9"],
  ["Dungeons", "135"],
  ["Ecchi", "12"],
  ["Emperor's daughter", "127"],
  ["Entertainment", "89"],
  ["Fan-Colored", "128"],
  ["Fantas", "80"],
  ["Fantasy", "13"],
  ["Fetish", "136"],
  ["Full Color", "75"],
  ["Game", "14"],
  ["Games", "163"],
  ["Gang", "122"],
  ["Gender Bender", "15"],
  ["Genderswap", "106"],
  ["Ghosts", "129"],
  ["Girls", "82"],
  ["Girls' Love", "69"],
  ["gore", "68"],
  ["gorre", "154"],
  ["Gyaru", "111"],
  ["Harem", "17"],
  ["Hentai", "112"],
  ["Hero", "99"],
  ["Historical", "18"],
  ["Horror", "19"],
  ["Imageset", "137"],
  ["Incest", "126"],
  ["Isekai", "20"],
  ["Josei", "21"],
  ["Josei(W)", "118"],
  ["Kids", "130"],
  ["Leveling", "164"],
  ["Loli", "150"],
  ["Lolicon", "73"],
  ["Long Strip", "76"],
  ["Mafia", "151"],
  ["Magi", "152"],
  ["Magic", "23"],
  ["Magical Girls", "116"],
  ["Martial Art", "101"],
  ["Martial Arts", "26"],
  ["Mature", "27"],
  ["Mecha", "28"],
  ["Medical", "29"],
  ["Military", "30"],
  ["Mirror", "110"],
  ["Modern", "159"],
  ["Monster Girls", "153"],
  ["Monsters", "96"],
  ["Murim", "79"],
  ["Music", "31"],
  ["Mystery", "32"],
  ["Necromancer", "160"],
  ["Ninja", "138"],
  ["Non-human", "139"],
  ["Office Workers", "103"],
  ["Official Colored", "156"],
  ["One-Shot", "84"],
  ["Oneshot", "147"],
  ["Overpowered", "161"],
  ["Parody", "140"],
  ["Pets", "162"],
  ["Philosophical", "102"],
  ["Police", "36"],
  ["Post-Apocalyptic", "104"],
  ["Project", "66"],
  ["Psychological", "37"],
  ["Regression", "70"],
  ["Reincarnation", "39"],
  ["Revenge", "65"],
  ["Reverse Harem", "71"],
  ["Reverse Isekai", "141"],
  ["Romance", "40"],
  ["Royalty", "142"],
  ["School", "41"],
  ["School life", "42"],
  ["Sci-fi", "44"],
  ["Seinen", "45"],
  ["Seinen(M)", "148"],
  ["Seinin", "123"],
  ["Sexual Violence", "85"],
  ["Shotacon", "46"],
  ["Shoujo", "47"],
  ["Shoujo Ai", "48"],
  ["Shoujo(G)", "121"],
  ["Shounen", "49"],
  ["Shounen Ai", "50"],
  ["Shounen(B)", "98"],
  ["Shounn", "165"],
  ["Showbiz", "143"],
  ["Slice of Life", "51"],
  ["Smut", "72"],
  ["Space", "144"],
  ["Sport", "52"],
  ["Sports", "53"],
  ["Super Power", "54"],
  ["Superhero", "93"],
  ["Supernatural", "55"],
  ["Supranatural", "95"],
  ["Survival", "63"],
  ["System", "88"],
  ["Thriller", "56"],
  ["Time Travel", "83"],
  ["Traditional Games", "145"],
  ["Tragedy", "57"],
  ["Transmigration", "131"],
  ["Vampire", "59"],
  ["Vampires", "107"],
  ["Video Games", "108"],
  ["Villainess", "100"],
  ["Violence", "157"],
  ["Virtual Reality", "109"],
  ["Web Comic", "77"],
  ["Webtoon", "90"],
  ["Webtoons", "60"],
  ["Wuxia", "81"],
  ["Xianxia", "124"],
  ["Xuanhuan", "120"],
  ["Yaoi", "155"],
  ["Yuri", "61"],
  ["Zombies", "86"],
];
