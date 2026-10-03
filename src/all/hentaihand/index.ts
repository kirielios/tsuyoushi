// Port of keiyoushi/extensions-source src/all/hentaihand/HentaiHand.kt
import { HentaiHand as HentaiHandTheme } from "../../../themes/hentaihand/index.ts";

const LANG_IDS: Record<string, number[]> = {
  all: [],
  ja: [3, 29],
  en: [2, 27],
  zh: [1, 50],
  bg: [4],
  ceb: [5, 44],
  other: [6],
  tl: [7, 55],
  ar: [8, 49],
  el: [9],
  sr: [10],
  jv: [11, 51],
  uk: [12, 46],
  tr: [13, 41],
  fi: [14, 54],
  la: [15],
  mn: [16],
  eo: [17, 47],
  sk: [18],
  cs: [19, 52],
  ko: [30, 39],
  ru: [31],
  it: [32],
  es: [33, 37],
  "pt-BR": [34],
  th: [35, 40],
  fr: [36],
  id: [38],
  vi: [42],
  de: [43],
  pl: [45],
  hu: [48],
  nl: [53],
  hi: [56],
};

export default class HentaiHand extends HentaiHandTheme {
  override readonly chapters = false;

  protected override get hhLangId() {
    return LANG_IDS[this.lang] ?? [];
  }
}
