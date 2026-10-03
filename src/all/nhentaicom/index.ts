// Port of keiyoushi/extensions-source src/all/nhentaicom/NHentaiCom.kt
import { HentaiHand } from "../../../themes/hentaihand/index.ts";

const LANG_IDS: Record<string, number[]> = {
  all: [],
  zh: [1],
  en: [2],
  ja: [3],
  other: [4],
  ar: [5],
  jv: [6],
  bg: [7],
  cs: [8],
  uk: [9],
  sk: [10],
  eo: [11],
  mn: [12],
  la: [13],
  ceb: [14],
  tl: [15],
  fi: [16],
  tr: [17],
  sr: [18],
  el: [19],
  ko: [20],
  ro: [21],
};

export default class NHentaiCom extends HentaiHand {
  override readonly chapters = false;

  protected override get hhLangId() {
    return LANG_IDS[this.lang] ?? [];
  }
}
