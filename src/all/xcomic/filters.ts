// Port of keiyoushi/extensions-source src/all/xcomic/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class CheckboxFilterOption extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}
export class TriStateFilterOption extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
    defaultIndex = 0,
  ) {
    super(
      name,
      options.map((it) => it[0]),
      defaultIndex,
    );
  }
  get selected(): string {
    return this.options[this.state][1];
  }
}

export abstract class CheckboxGroupFilter extends Filter.Group<CheckboxFilterOption> {
  constructor(name: string, options: [string, string][]) {
    super(
      name,
      options.map((it) => new CheckboxFilterOption(it[0], it[1])),
    );
  }
  get selected(): string[] {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
}

export abstract class TriStateGroupFilter extends Filter.Group<TriStateFilterOption> {
  constructor(name: string, options: [string, string][]) {
    super(
      name,
      options.map((it) => new TriStateFilterOption(it[0], it[1])),
    );
  }
  get included(): string[] {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.value);
  }
  get excluded(): string[] {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.value);
  }
}

export class SortFilter extends SelectFilter {
  constructor(options: [string, string][] = sortOptions, defaultIndex = 0) {
    super("Order by", options, defaultIndex);
  }
}

export class OriginalStatusFilter extends CheckboxGroupFilter {
  constructor(options: [string, string][] = uploadStatus) {
    super("Original Work Status", options);
  }
}

export class MinChapterFilter extends Filter.Text {
  constructor() {
    super("Minimum Chapter Count");
  }
}
export class MaxChapterFilter extends Filter.Text {
  constructor() {
    super("Maximum Chapter Count");
  }
}

export class OriginalLanguageFilter extends CheckboxGroupFilter {
  constructor(options: [string, string][] = languages) {
    super("Original Work Language", options);
  }
}

export class TranslationLanguageFilter extends CheckboxGroupFilter {
  constructor(options: [string, string][] = languages) {
    super("Translated Language", options);
  }
}

export class ContentRatingFilter extends CheckboxGroupFilter {
  constructor(options: [string, string][] = []) {
    super("Content Rating", options);
  }
}

export class TypeFilter extends CheckboxGroupFilter {
  constructor(options: [string, string][] = []) {
    super("Types", options);
  }
}

export class DemographicFilter extends CheckboxGroupFilter {
  constructor(options: [string, string][] = []) {
    super("Demographics", options);
  }
}

export class FormatFilter extends TriStateGroupFilter {
  constructor(options: [string, string][] = formatOptions) {
    super("Formats", options);
  }
}

export class GenreGroupFilter extends TriStateGroupFilter {
  constructor(name = "Genres", options: [string, string][] = []) {
    super(name, options);
  }
}

export class GenreInModeFilter extends SelectFilter {
  constructor() {
    super(
      "Include Mode",
      [
        ["AND", "and"],
        ["OR", "or"],
      ],
      0,
    );
  }
}

export class GenreExModeFilter extends SelectFilter {
  constructor() {
    super(
      "Exclude Mode",
      [
        ["AND", "and"],
        ["OR", "or"],
      ],
      1,
    );
  }
}

export class YearFilter extends Filter.Text {
  constructor() {
    super("Year (e.g. 2015 or 1901-2027)");
  }
}

// --- Hardcoded Constants ---
export const languages: [string, string][] = [
  ["English", "en"],
  ["French", "fr"],
  ["Portuguese", "pt"],
  ["Korean", "ko"],
  ["Japanese", "ja"],
  ["Indonesian", "id"],
  ["Chinese", "zh"],
  ["Chinese (Traditional)", "zh_hk"],
  ["Abkhazian", "ab"],
  ["Afrikaans", "af"],
  ["Armenian", "hy"],
  ["Arabic", "ar"],
  ["Albanian", "sq"],
  ["Azerbaijani", "az"],
  ["Belarusian", "be"],
  ["Bengali", "bn"],
  ["Burmese", "my"],
  ["Bulgarian", "bg"],
  ["Bosnian", "bs"],
  ["Cambodian", "km"],
  ["Catalan", "ca"],
  ["Cebuano", "ceb"],
  ["Czech", "cs"],
  ["Croatian", "hr"],
  ["Chuvash", "cv"],
  ["Danish", "da"],
  ["Dutch", "nl"],
  ["Estonian", "et"],
  ["Esperanto", "eo"],
  ["Basque", "eu"],
  ["Filipino", "fil"],
  ["Finnish", "fi"],
  ["German", "de"],
  ["Georgian", "ka"],
  ["Greek", "el"],
  ["Guarani", "gn"],
  ["Gujarati", "gu"],
  ["Hindi", "hi"],
  ["Hebrew", "he"],
  ["Haitian Creole", "ht"],
  ["Hungarian", "hu"],
  ["Icelandic", "is"],
  ["Igbo", "ig"],
  ["Galician", "gl"],
  ["Irish", "ga"],
  ["Italian", "it"],
  ["Kazakh", "kk"],
  ["Kyrgyz", "ky"],
  ["Lithuanian", "lt"],
  ["Latin", "la"],
  ["Laothian", "lo"],
  ["Kurdish", "ku"],
  ["Javanese", "jv"],
  ["Malagasy", "mg"],
  ["Latvian", "lv"],
  ["Malay", "ms"],
  ["Malayalam", "ml"],
  ["Maltese", "mt"],
  ["Moldavian", "mo"],
  ["Marathi", "mr"],
  ["Maori", "mi"],
  ["Mongolian", "mn"],
  ["Nyanja", "ny"],
  ["Nepali", "ne"],
  ["Pashto", "ps"],
  ["Norwegian", "no"],
  ["Persian", "fa"],
  ["Portuguese (BR)", "pt_br"],
  ["Serbian", "sr"],
  ["Sesotho", "st"],
  ["Russian", "ru"],
  ["Romanian", "ro"],
  ["Polish", "pl"],
  ["Serbo-Croatian", "sh"],
  ["Sinhalese", "si"],
  ["Somali", "so"],
  ["Swedish", "sv"],
  ["Thai", "th"],
  ["Turkish", "tr"],
  ["Swati", "ss"],
  ["Slovak", "sk"],
  ["Spanish", "es"],
  ["Tigrinya", "ti"],
  ["Tamil", "ta"],
  ["Turkmen", "tk"],
  ["Ukrainian", "uk"],
  ["Tonga", "to"],
  ["Telugu", "te"],
  ["Spanish (LA)", "es_419"],
  ["Slovenian", "sl"],
  ["Vietnamese", "vi"],
  ["Urdu", "ur"],
  ["Yoruba", "yo"],
  ["Other", "_t"],
  ["Uzbek", "uz"],
  ["Zulu", "zu"],
];
export const formatOptions: [string, string][] = [
  ["1-Koma", "1_koma"],
  ["2-Koma", "2_koma"],
  ["3-Koma", "3_koma"],
  ["4-Koma", "4_koma"],
  ["Adaptation", "adaptation"],
  ["Anthology", "anthology"],
  ["Artbook", "artbook"],
  ["Award Winning", "award_winning"],
  ["Doujinshi", "doujinshi"],
  ["Fan Colored", "fan_colored"],
  ["Fanbook", "fanbook"],
  ["Fanwork", "fanwork"],
  ["Full Color", "full_color"],
  ["Guidebook", "guidebook"],
  ["Illustbook", "illustbook"],
  ["Illustration Book", "illustration_book"],
  ["Japanese Novel", "japanese_novel"],
  ["Light Novel", "light_novel"],
  ["Long Strip", "long_strip"],
  ["Longstrip", "longstrip"],
  ["Novels", "novels"],
  ["Official Colored", "official_colored"],
  ["Oneshot", "oneshot"],
  ["Original Doujinshi", "original_doujinshi"],
  ["Partially Colored", "partially_colored"],
  ["Partially Colored Webtoon", "partially_colored_webtoon"],
  ["Web Comic", "web_comic"],
  ["Web Novel", "web_novel"],
  ["Webtoon", "webtoon"],
];
export const uploadStatus: [string, string][] = [
  ["Releasing", "releasing"],
  ["Completed", "completed"],
  ["Hiatus", "hiatus"],
  ["Cancelled", "cancelled"],
  ["Upcoming", "upcoming"],
  ["Unknown", "unknown"],
];
export const sortOptions: [string, string][] = [
  ["Rating Score", "field_score"],
  ["Latest Update", "field_update"],
  ["Recently Added", "field_create"],
  ["Name A-Z", "field_name_asc"],
  ["Name Z-A", "field_name_desc"],
  ["Most Follows", "field_follow"],
  ["Most Reviews", "field_review"],
  ["Most Comments", "field_comment"],
  ["Most Chapters", "field_chapter"],
];
