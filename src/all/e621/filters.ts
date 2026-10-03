// Port of keiyoushi/extensions-source src/all/e621/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export const tagFilter = new Set<string>([

    "accipitrid", "accipitriform", "ailurid", "alien_humanoid", "alligatorid",
    "ambiguous_species", "amphibian", "anatid", "animal_humanoid", "animate_inanimate",
    "anseriform", "aquatic", "aquatic_humanoid", "arachnid", "arthropod", "asinus",
    "avian", "boss_monster_(undertale)", "bovid", "bovid_humanoid", "bovine", "canid",
    "canid_demon", "canid_humanoid", "canine", "canine_humanoid", "canis", "caprine",
    "cattle", "cat_humanoid", "cephalopod", "cephalopod_humanoid", "cervine", "cetacean",
    "corvid", "crocodilian", "demon_humanoid", "domestic_ferret", "draconcopode",
    "dromaeosaurid", "earth_pony", "eeveelution", "elemental_creature",
    "elemental_humanoid", "equid", "equine", "eulipotyphlan", "felid", "feline",
    "feline_humanoid", "felis", "flora_fauna", "fox_humanoid", "galliform",
    "generation_1_pokemon", "generation_2_pokemon", "generation_3_pokemon",
    "generation_4_pokemon", "generation_5_pokemon", "generation_6_pokemon",
    "generation_7_pokemon", "generation_8_pokemon", "generation_9_pokemon", "giraffid",
    "haplorhine", "horned_humanoid", "humanoid", "hunting_dog", "hymenopteran",
    "lagomorph", "lagomorph_humanoid", "legendary_pokemon", "lepidopteran", "leporid",
    "leporid_humanoid", "macropod", "mammal", "mammal_humanoid", "mammal_taur",
    "marsupial", "mega_evolution", "mollusk", "mollusk_humanoid", "monotreme", "murid",
    "murine", "mustelid", "musteline", "mythological_avian", "mythological_canine",
    "mythological_creature", "mythological_equine", "mythological_scalie",
    "ornithischian", "oryctolagus", "oscine", "pantherine", "passerine", "phasianid",
    "pinscher", "prehistoric_species", "primate", "procyonid", "rabbit_humanoid",
    "regional_form_(pokemon)", "reptile", "retriever", "robot_humanoid", "rodent",
    "saurischian", "scalie", "sciurid", "shiba_inu", "shiny_pokemon", "spitz", "suid",
    "suine", "tailed_humanoid", "taur", "true_musteline", "werecanine", "werecreature",
    "yokai",
    "3_toes", "4_fingers", "4_toes", "5_fingers", "accessory", "animal_penis", "areola",
    "armwear", "barefoot", "beak", "bed", "belly", "biceps", "black_body",
    "black_clothing", "black_eyes", "black_fur", "black_hair", "black_nose",
    "blonde_hair", "blue_body", "blue_eyes", "blue_fur", "blue_hair", "blush",
    "blush_lines", "bodily_fluids", "border", "bottomwear", "brown_body", "brown_eyes",
    "brown_fur", "brown_hair", "butt", "canine_genitalia", "canine_penis", "clitoris",
    "clothing", "collar", "container", "countershading", "cutie_mark",
    "detailed_background", "dipstick_tail", "ear_piercing", "ear_ring", "electronics",
    "equine_penis", "eyebrows", "eyelashes", "eyes_closed", "facial_hair",
    "facial_piercing", "feathered_wings", "fingers", "finger_claws", "footwear",
    "front_view", "furniture", "genitals", "genital_fluids", "gesture", "glans", "gloves",
    "grass", "green_body", "green_eyes", "grey_background", "grey_body", "grey_fur",
    "grin", "hair", "hair_accessory", "half-closed_eyes", "handwear", "happy", "hat",
    "headwear", "heart_symbol", "holding_object", "holidays", "hooves", "horn",
    "humanoid_hands", "humanoid_penis", "inside", "jewelry", "kneeling", "legwear",
    "long_hair", "looking_at_another", "looking_back", "lying", "machine",
    "membrane_(anatomy)", "membranous_wings", "multicolored_hair", "muscular_anthro",
    "narrowed_eyes", "navel", "necklace", "nude_anthro", "one_eye_closed", "on_bed",
    "orange_body", "orange_fur", "pants", "pawpads", "paws", "pecs", "penile",
    "penile_penetration", "pillow", "pink_body", "pink_hair", "pink_nose", "plant",
    "pointy_ears", "pupils", "purple_body", "purple_eyes", "purple_hair", "rear_view",
    "red_body", "red_eyes", "red_hair", "scales", "sheath", "shirt", "shoes", "shorts",
    "short_hair", "simple_background", "sitting", "skirt", "sky", "smile", "soles",
    "sound_effects", "speech_bubble", "spikes", "spots", "standing", "stripes", "tail",
    "tan_fur", "teeth", "text", "toe_claws", "topwear", "translucent", "tree",
    "two_tone_body", "two_tone_fur", "vaginal", "vaginal_fluids", "water", "whiskers",
    "white_background", "white_body", "white_clothing", "white_fur", "white_hair",
    "yellow_body", "yellow_eyes", "yellow_fur",
    "conditional_dnp", "sound_warning",
    "underwear", "sniffing", "animal_genitalia", "erection", "tongue", "page_number",
    "countershade_torso", "motion_lines", "tunic", "panel_skew", "interior_background",
    "headgear", "blue_sky", "5_toes", "4_toes", "3_toes", "onomatopoeia", "color_coded",
    "color_coded_speech_bubble", "patreon", "polygonal_speech_bubble", "blockage_(layout)",
]);

export function getE621FilterList(categoryPref: string): FilterList {
  return FilterList(
    new Filter.Header("Note: You will need to be logged into E621 via WebView to see certain posts (e.g., 'No Image')"),
    new ModeFilter(),
    new Filter.Separator(),
    new PoolGroupFilter("Pool Search Options", categoryPref),
    new Filter.Separator(),
    new TagGroupFilter("Tag Search Options"),
  );
}

export class PoolGroupFilter extends Filter.Group<Filter> {
  constructor(displayName: string, categoryPref: string) {
    super(displayName, [new Filter.Header("(Pools Search Mode only)"), new DescriptionFilter(), new OrderFilter(), new CategoryFilter(getDefaultCategoryIndex(categoryPref)), new ActiveOnlyFilter()]);
  }
  getDescription = () => (this.state[1] as DescriptionFilter).state.trim();
  getOrder = () => (this.state[2] as OrderFilter).toUriPart();
  getCategory = () => (this.state[3] as CategoryFilter).toUriPart();
  getActiveOnly = () => (this.state[4] as ActiveOnlyFilter).state;
}

export class TagGroupFilter extends Filter.Group<Filter> {
  constructor(displayName: string) {
    super(displayName, [
      new Filter.Header("(Tags Search Mode only)"),
      new OrderTagFilter(),
      new DateFilter(),
      new TagsFilter(),
      new Filter.Header("e.g.,  `anthro  -mammal  order:random  date:month  score:>100`"),
      new Filter.Header("Negative tags may not filter everything"),
      new FirstPageFilter(),
      new EndPageFilter(),
      new Filter.Header("Warning: will filter out pools that don't use the `first_page` or `end_page` tags."),
    ]);
  }
  getOrderTag = () => (this.state[1] as OrderTagFilter).toUriPart();
  getDate = () => (this.state[2] as DateFilter).toUriPart();
  getTags = () => (this.state[3] as TagsFilter).state.trim();
  getFirstPage = () => (this.state[6] as FirstPageFilter).state;
  getEndPage = () => (this.state[7] as EndPageFilter).state;
}

export function getDefaultModeIndex(modePref: string): number {
  switch (modePref) {
    case "pools":
      return 0;
    case "tags":
      return 1;
    default:
      return 0;
  }
}

export function getDefaultCategoryIndex(categoryPref: string): number {
  switch (categoryPref) {
    case "series":
      return 1;
    case "collection":
      return 2;
    default:
      return 0;
  }
}

export function getDefaultOrderIndex(orderPref: string): number {
  switch (orderPref) {
    case "updated_at":
      return 0;
    case "post_count":
      return 1;
    case "name":
      return 2;
    case "created_at":
      return 3;
    default:
      return 0;
  }
}

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    readonly vals: [string, string][],
    defaultIndex = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
      defaultIndex,
    );
  }
  toUriPart = () => this.vals[this.state][1];
}

export class ModeFilter extends UriPartFilter {
  constructor(defaultIndex = 0) {
    super(
      "Search Mode",
      [
        ["Pools", "pools.json"],
        ["Tags", "posts.json"],
      ],
      defaultIndex,
    );
  }
}

export class OrderFilter extends UriPartFilter {
  constructor(defaultIndex = 0) {
    super(
      "Order by",
      [
        ["Recently Updated", "updated_at"],
        ["Most Posts", "post_count"],
        ["Name (A-Z)", "name"],
        ["Newest First", "created_at"],
      ],
      defaultIndex,
    );
  }
}

export class OrderTagFilter extends UriPartFilter {
  constructor(defaultIndex = 0) {
    super(
      "Order by",
      [
        ["Default", ""],
        ["Newest", "id_desc"],
        ["Oldest", "id"],
        ["Score", "score"],
        ["Hot", "hot"],
        ["Favorites", "favcount"],
        ["Random", "random"],
      ],
      defaultIndex,
    );
  }
}

export class DateFilter extends UriPartFilter {
  constructor(defaultIndex = 0) {
    super(
      "Filter Date by",
      [
        ["All Time", ""],
        ["Day", "day"],
        ["Week", "week"],
        ["Month", "month"],
        ["Year", "year"],
      ],
      defaultIndex,
    );
  }
}

export class CategoryFilter extends UriPartFilter {
  constructor(defaultIndex = 0) {
    super(
      "Category",
      [
        ["Any", ""],
        ["Series", "series"],
        ["Collection", "collection"],
      ],
      defaultIndex,
    );
  }
}

export class TagsFilter extends Filter.Text {
  constructor(defaultTags = "") {
    super("Space Separated Tags", defaultTags);
  }
}

export class ActiveOnlyFilter extends Filter.CheckBox {
  constructor() {
    super("Active pools only", false);
  }
}

export class FirstPageFilter extends Filter.CheckBox {
  constructor() {
    super("Search tags by first pages", false);
  }
}

export class EndPageFilter extends Filter.CheckBox {
  constructor() {
    super("Search tags by end pages", false);
  }
}

export class DescriptionFilter extends Filter.Text {
  constructor() {
    super("Description contains");
  }
}
