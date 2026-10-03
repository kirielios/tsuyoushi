// Port of keiyoushi/extensions-source src/en/qiscans/QiScansGenreFilter.kt
import { Filter } from "../../../sdk/index.ts";

const ENTRIES: [string, string][] = [
  ["All", ""],
  ["Acting", "acting"],
  ["Action", "action"],
  ["Action (Alt)", "action-582"],
  ["Adventure", "adventure"],
  ["Adventure (Alt)", "adventure-589"],
  ["Apocalypse", "apocalypce"],
  ["Comedy", "comedy"],
  ["Cooking", "cooking"],
  ["Crazy MC", "crazy-mc"],
  ["Cultivation", "cultivation"],
  ["Drama", "drama"],
  ["Ecchi", "ecchi"],
  ["Fantasy", "fantasy"],
  ["Fantasy (Alt)", "fantasy-747"],
  ["Fight", "fight"],
  ["Gender Bender", "gender-bender"],
  ["Harem", "harem"],
  ["Hidden", "hidden"],
  ["Historical", "historical"],
  ["Horror", "horror"],
  ["Josei", "josei"],
  ["Live", "live"],
  ["Magic", "magic"],
  ["Manhua", "manhua"],
  ["Martial Arts", "martial-arts"],
  ["Mature", "mature"],
  ["Mecha", "mecha"],
  ["Medieval Area", "medieval-area"],
  ["Munchkin", "munchkin"],
  ["Murim", "murim"],
  ["Mystery", "mystery"],
  ["Myth", "myth"],
  ["Politics", "politics"],
  ["Psychological", "psychological"],
  ["Reincarnation", "reincarnation"],
  ["Revenge", "revenge"],
  ["Romance", "romance"],
  ["School Life", "school-life"],
  ["Sci-Fi", "sci-fi"],
  ["Seinen", "seinen"],
  ["Shounen", "shounen"],
  ["Slice of Life", "slice-of-life"],
  ["Sports", "sports"],
  ["Supernatural", "supernatural"],
  ["Superpower", "superpower"],
  ["System", "system"],
  ["Taming", "taming"],
  ["Tower", "tower"],
  ["Tragedy", "tragedy"],
  ["Urban", "urban"],
  ["Vampires", "vampiers"],
  ["Virtual Reality", "virtual-reality"],
  ["Wuxia", "wuxia"],
];

export class QiScansGenreFilter extends Filter.Select<string> {
  static readonly DISPLAY = ENTRIES.map((it) => it[0]);
  static readonly VALUES = ENTRIES.map((it) => it[1]);
  constructor() {
    super("Genre", QiScansGenreFilter.DISPLAY);
  }
  get value() {
    return QiScansGenreFilter.VALUES[this.state];
  }
}
