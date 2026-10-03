// Port of keiyoushi/extensions-source src/all/xasiatalbums/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(displayName, vals.map((it) => it[0]));
  }
  toUriPart(): string {
    return this.vals[this.state][1];
  }
}

// "None" is intentionally kept as the FIRST entry (index 0) so that
// the `categoryFilter.state > 0` guard in searchMangaRequest works correctly.
// All other entries are sorted at build-time in XAsiatAlbums.getFilterList().
export const initialCategories: Map<string, string> = new Map([
  ["None", ""],
  ["China & Taiwan", "albums/categories/china-taiwan"],
  ["South Korea", "albums/categories/korea"],
  ["JAV & AV Models", "albums/categories/jav"],
  ["Gravure Idols", "albums/categories/gravure-idols"],
  ["Amateur", "albums/categories/amateur3"],
  ["Western Girls", "albums/categories/western-girls"],
  ["Southeast Asia", "albums/categories/southeast-asia"],
  ["JAV Amateur", "albums/categories/jav-amateur"],
  ["Cosplay", "albums/tags/cosplay"],
  ["Japanese", "albums/tags/japanese"],
  ["Japan", "albums/tags/japan"],
  ["Photobook", "albums/tags/photobook"],
  ["Friday", "albums/tags/friday"],
  ["Korean", "albums/tags/korean"],
  ["Friday Digital Photobook", "albums/tags/friday-digital-photobook"],
  ["Graphis", "albums/tags/graphis"],
  ["Lovepop", "albums/tags/lovepop"],
  ["Fantia", "albums/tags/fantia"],
  ["Gals", "albums/tags/gals"],
  ["Friday Gold", "albums/tags/friday-gold"],
  ["Girlz-High", "albums/tags/girlz-high"],
  ["Xiuren", "albums/tags/xiuren"],
  ["Weekly Playboy", "albums/tags/weekly-playboy"],
  ["Leehee Express", "albums/tags/leehee-express"],
  ["Flash", "albums/tags/flash"],
  ["Young Magazine", "albums/tags/young-magazine"],
  ["Bunny", "albums/tags/bunny"],
  ["Nude", "albums/tags/nude"],
  ["JVID", "albums/tags/jvid"],
  ["Maid", "albums/tags/maid"],
  ["Artgravia", "albums/tags/artgravia"],
  ["Onlyfans", "albums/tags/onlyfans"],
  ["Young Jump", "albums/tags/young-jump"],
  ["Young Champion", "albums/tags/young-champion"],
  ["Big Comic Spirits", "albums/tags/big-comic-spirits"],
  ["Uniform", "albums/tags/uniform"],
  ["Shonen Magazine", "albums/tags/shonen-magazine"],
  ["Xiaoyu", "albums/tags/xiaoyu"],
  ["Summertime", "albums/tags/summertime"],
  ["Patreon", "albums/tags/patreon"],
  ["Swimsuit", "albums/tags/swimsuit"],
  ["Tiny Body", "albums/tags/tiny-body"],
  ["Yuuhui", "albums/tags/yuuhui"],
  ["Yanmaga Web", "albums/tags/yanmaga-web"],
  ["Shonen Sunday", "albums/tags/shonen-sunday"],
  ["Bejean On Line", "albums/tags/bejean-on-line"],
  ["Djawa", "albums/tags/djawa"],
  ["Pure Media", "albums/tags/pure-media"],
  ["School", "albums/tags/school"],
  ["Night", "albums/tags/night"],
  ["Espacia Korea", "albums/tags/espacia-korea"],
  ["Bikini", "albums/tags/bikini"],
  ["Black", "albums/tags/black"],
  ["Bluecake", "albums/tags/bluecake"],
  ["Teen", "albums/tags/teen"],
  ["Loozy", "albums/tags/loozy"],
  ["Allgravure", "albums/tags/allgravure"],
  ["Girls", "albums/tags/girls"],
]);
