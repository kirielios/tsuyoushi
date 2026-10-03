// Port of keiyoushi/extensions-source src/en/myhentaigallery/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart = () => this.vals[this.state][1];
}

export class SortFilter extends UriPartFilter {
  constructor() {
    super("Sort By", [
      ["Newest", "gpage"],
      ["Most Viewed", "views"],
      ["Most Favorited", "favorites"],
      ["Most Commented", "comments"],
      ["Longest", "amount"],
    ]);
  }
}

export class GenreFilter extends UriPartFilter {
  constructor() {
    super("Category", [
      ["All", ""],
      ["3D Comic", "3"],
      ["Ahegao", "23"],
      ["Anal", "25"],
      ["Animated", "10"],
      ["Asian", "54"],
      ["Ass Expansion", "5"],
      ["Aunt", "6"],
      ["BBW", "7"],
      ["Beastiality", "8"],
      ["Bimbofication", "2049"],
      ["Bisexual", "9"],
      ["Black | Interracial", "20"],
      ["Body Swap", "11"],
      ["Bondage", "12"],
      ["Breast Expansion", "13"],
      ["Brother", "1012"],
      ["Bukkake", "15"],
      ["Catgirl", "1201"],
      ["Cbt", "8133"],
      ["Censored", "5136"],
      ["Cheating", "49"],
      ["Cosplay", "8157"],
      ["Cousin", "17"],
      ["CrimsonCoax", "11531"],
      ["Crossdressing", "43"],
      ["Cuntboy", "8134"],
      ["Dad | Father", "788"],
      ["Daughter", "546"],
      ["Dick Growth", "21"],
      ["Double Penetration", "8135"],
      ["Ebony", "29"],
      ["Elf", "1714"],
      ["Exhibitionism", "1838"],
      ["Family", "2094"],
      ["Femboy | Tomgirl | Sissy", "8136"],
      ["Femdom", "24"],
      ["Foot Fetish", "1873"],
      ["Forced", "18"],
      ["Furry", "14"],
      ["Futanari | Shemale | Dickgirl", "19"],
      ["Futanari X Female", "1951"],
      ["Futanari X Futanari", "1885"],
      ["Futanari X Male", "26"],
      ["Gangbang", "27"],
      ["Gay | Yaoi", "28"],
      ["Gender Bender", "16"],
      ["Giant", "8137"],
      ["Giantess", "452"],
      ["Gilf", "8138"],
      ["Gloryhole", "31"],
      ["Group", "101"],
      ["Hairy Female", "1986"],
      ["Hardcore", "36"],
      ["Harem", "53"],
      ["Inflation | Stomach Bulge", "57"],
      ["Inseki", "1978"],
      ["Kemonomimi", "1875"],
      ["Lactation", "39"],
      ["Legendary", "6293"],
      ["Lesbian | Yuri | Girls Only", "41"],
      ["Milf", "30"],
      ["Mind Break", "2023"],
      ["Mind Control | Hypnosis", "42"],
      ["Mom | Mother", "56"],
      ["Monster", "8140"],
      ["Monster Girl", "8139"],
      ["Most Popular", "52"],
      ["Muscle Girl", "45"],
      ["Muscle Growth", "46"],
      ["Nephew", "47"],
      ["Niece", "48"],
      ["Nipple Fuck | Nipple Penetration", "8141"],
      ["Pegging", "50"],
      ["Possession", "51"],
      ["Pregnant | Impregnation", "55"],
      ["Public Use", "8142"],
      ["Selfcest", "8143"],
      ["Sister", "58"],
      ["Slave", "8144"],
      ["Smegma", "8145"],
      ["Solo", "1865"],
      ["Solo Futa", "8154"],
      ["Solo Girl", "8146"],
      ["Solo Male", "8147"],
      ["Son", "62"],
      ["Spanking", "38"],
      ["Speechless", "8148"],
      ["Strap-On", "61"],
      ["Stuck In Wall", "8149"],
      ["Superheroes", "59"],
      ["Tentacles", "60"],
      ["Threesome", "40"],
      ["Tickling", "2065"],
      ["Titty Fuck | Paizuri", "8150"],
      ["Tomboy", "8153"],
      ["Transformation", "37"],
      ["Uncle", "63"],
      ["Urination", "64"],
      ["Vanilla | Wholesome", "8151"],
      ["Variant Set", "8152"],
      ["Vore | Unbirth", "65"],
      ["Weight Gain", "66"],
    ]);
  }
}

export class TagLookupFilter extends Filter.Text {
  constructor(
    displayName: string,
    readonly uriPart: string,
  ) {
    super(displayName);
  }
}

export class ArtistFilter extends TagLookupFilter {
  constructor() {
    super("Artists", "artist");
  }
}

export class ParodyFilter extends TagLookupFilter {
  constructor() {
    super("Parodies", "parody");
  }
}
