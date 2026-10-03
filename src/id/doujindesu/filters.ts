// Port of keiyoushi/extensions-source src/id/doujindesu/Filters.kt
import { Filter } from "../../../sdk/index.ts";

// Upstream extends Filter.TriState for these option types, but only uses them as Select values; plain classes suffice.
export class Category {
  constructor(
    readonly name: string,
    readonly key: string,
  ) {}
  toString(): string {
    return this.name;
  }
}

export class Genre extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string = name,
  ) {
    super(name);
  }
  override toString(): string {
    return this.id;
  }
}

export class Order extends Category {}
export class Status extends Category {}

export class AuthorGroupSeriesOption {
  constructor(
    readonly display: string,
    readonly key: string,
  ) {}
  toString(): string {
    return this.display;
  }
}

export class AuthorGroupSeriesFilter extends Filter.Select<AuthorGroupSeriesOption> {
  constructor(options: AuthorGroupSeriesOption[]) {
    super("Filter Tipe", options, 0);
  }
}
export class AuthorGroupSeriesValueFilter extends Filter.Text {
  constructor() {
    super("Nama");
  }
}
export class CategoryNames extends Filter.Select<Category> {
  constructor(categories: Category[]) {
    super("Kategori", categories, 0);
  }
}
export class OrderBy extends Filter.Select<Order> {
  constructor(orders: Order[]) {
    super("Urutkan", orders, 0);
  }
}
export class GenreList extends Filter.Group<Genre> {
  constructor(genres: Genre[]) {
    super("Genre", genres);
  }
}
export class StatusList extends Filter.Select<Status> {
  constructor(statuses: Status[]) {
    super("Status", statuses, 0);
  }
}

export const orderBy = [
  new Order("Update Terbaru", "latest_chapter"),
  new Order("Baru Ditambahkan", "newest"),
  new Order("Terlama", "oldest"),
  new Order("Populer", "rating"),
  new Order("A-Z", "title_asc"),
];

export const statusList = [new Status("Semua", ""), new Status("Berlanjut", "publishing"), new Status("Selesai", "completed"), new Status("Hiatus", "hiatus")];

export const categoryNames = [new Category("Semua", ""), new Category("Doujinshi", "doujinshi"), new Category("Manga", "manga"), new Category("Manhwa", "manhwa")];

export const authorGroupSeriesOptions = [
  new AuthorGroupSeriesOption("Tidak Ada", ""),
  new AuthorGroupSeriesOption("Penulis", "authors"),
  new AuthorGroupSeriesOption("Grup", "groups"),
  new AuthorGroupSeriesOption("Genre", "genres"),
  new AuthorGroupSeriesOption("Seri", "series"),
  new AuthorGroupSeriesOption("Karakter", "characters"),
];

export const getGenreList = () => GENRES.map((it) => new Genre(it));
const GENRES = [
  "Age Progression",
  "Age Regression",
  "Ahegao",
  "All The Way Through",
  "Amputee",
  "Anal",
  "Anorexia",
  "Apron",
  "Artist CG",
  "Aunt",
  "Bald",
  "Bestiality",
  "Big Ass",
  "Big Breast",
  "Big Penis",
  "Bike Shorts",
  "Bikini",
  "Birth",
  "Bisexual",
  "Blackmail",
  "Blindfold",
  "Bloomers",
  "Blowjob",
  "Body Swap",
  "Bodysuit",
  "Bondage",
  "Business Suit",
  "Cheating",
  "Collar",
  "Condom",
  "Cousin",
  "Crossdressing",
  "Cunnilingus",
  "DILF",
  "Dark Skin",
  "Daughter",
  "Defloration",
  "Demon",
  "Demon Girl",
  "Dick Growth",
  "Double Penetration",
  "Drugs",
  "Drunk",
  "Elf",
  "Emotionless Sex",
  "Exhibitionism",
  "Eyepatch",
  "Females Only",
  "Femdom",
  "Filming",
  "Fingering",
  "Footjob",
  "Full Color",
  "Furry",
  "Futanari",
  "Garter Belt",
  "Gender Bender",
  "Ghost",
  "Glasses",
  "Group",
  "Guro",
  "Gyaru",
  "Hairy",
  "Handjob",
  "Harem",
  "Horns",
  "Huge Breast",
  "Huge Penis",
  "Humiliation",
  "Impregnation",
  "Incest",
  "Inflation",
  "Insect",
  "Inseki",
  "Inverted Nipples",
  "Invisible",
  "Kemomi",
  "Kemomimi",
  "Kimono",
  "Lactation",
  "Leotard",
  "Lingerie",
  "Loli",
  "Lolipai",
  "MILF",
  "Maid",
  "Males Only",
  "Masturbation",
  "Miko",
  "Mind Break",
  "Mind Control",
  "Minigirl",
  "Miniguy",
  "Monster",
  "Monster Girl",
  "Mother",
  "Multi-work Series",
  "Muscle",
  "Nakadashi",
  "Necrophilia",
  "Netorare",
  "Niece",
  "Nipple Fuck",
  "Nurse",
  "Old Man",
  "Oyakodon",
  "Paizuri",
  "Pantyhose",
  "Possession",
  "Pregnant",
  "Prostitution",
  "Rape",
  "Rimjob",
  "Scat",
  "School Uniform",
  "Sex Toys",
  "Shemale",
  "Shota",
  "Sister",
  "Sleeping",
  "Slime",
  "Small Breast",
  "Snuff",
  "Sole Female",
  "Sole Male",
  "Stocking",
  "Story Arc",
  "Sumata",
  "Sweating",
  "Swimsuit",
  "Tanlines",
  "Teacher",
  "Tentacles",
  "Tomboy",
  "Tomgirl",
  "Torture",
  "Twins",
  "Twintails",
  "Uncensored",
  "Unusual Pupils",
  "Virginity",
  "Webtoon",
  "Widow",
  "X-Ray",
  "Yandere",
  "Yaoi",
  "Yuri",
];
