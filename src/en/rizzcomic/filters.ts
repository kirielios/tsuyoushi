// Port of keiyoushi/extensions-source src/en/rizzcomic/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

/** FormBody.Builder -> URLSearchParams */
export interface FormBodyFilter {
  addFormParameter(form: URLSearchParams): void;
}

export const isFormBodyFilter = (it: Filter): it is Filter & FormBodyFilter => typeof (it as Partial<FormBodyFilter>).addFormParameter === "function";

abstract class SelectFilter extends Filter.Select<string> implements FormBodyFilter {
  constructor(
    name: string,
    private readonly options: [string, string][],
    defaultValue: string | null = null,
  ) {
    const i = options.findIndex((it) => it[1] === defaultValue);
    super(
      name,
      options.map((it) => it[0]),
      i !== -1 ? i : 0,
    );
  }
  abstract readonly formParameter: string;
  addFormParameter(form: URLSearchParams) {
    form.append(this.formParameter, this.options[this.state][1]);
  }
}

const sort: [string, string][] = [
  ["Default", "all"],
  ["A-Z", "title"],
  ["Z-A", "titlereverse"],
  ["Latest Update", "update"],
  ["Latest Added", "latest"],
  ["Popular", "popular"],
];

const status: [string, string][] = [
  ["All", "all"],
  ["Ongoing", "ongoing"],
  ["Complete", "completed"],
  ["Hiatus", "hiatus"],
];

const type: [string, string][] = [
  ["All", "all"],
  ["Manga", "manga"],
  ["Manhwa", "manhwa"],
  ["Manhua", "manhua"],
  ["Comic", "comic"],
];

export class StatusFilter extends SelectFilter {
  readonly formParameter = "StatusValue";
  constructor() {
    super("Status", status);
  }
}

export class TypeFilter extends SelectFilter {
  readonly formParameter = "TypeValue";
  constructor() {
    super("Type", type);
  }
}

export class SortFilter extends SelectFilter {
  readonly formParameter = "OrderValue";
  constructor(defaultOrder: string | null = null) {
    super("Sort By", sort, defaultOrder);
  }
  // companion object vals; getters so they are not evaluated before the classes they use exist
  static get POPULAR() {
    return FilterList(new StatusFilter(), new TypeFilter(), new SortFilter("popular"));
  }
  static get LATEST() {
    return FilterList(new StatusFilter(), new TypeFilter(), new SortFilter("update"));
  }
}

export class CheckBoxFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class GenreFilter
  extends Filter.Group<CheckBoxFilter>
  implements FormBodyFilter
{
  constructor() {
    super(
      "Genre",
      genres.map((it) => new CheckBoxFilter(it[0], it[1])),
    );
  }
  addFormParameter(form: URLSearchParams) {
    this.state.filter((it) => it.state).forEach((it) => form.append("genres_checked[]", it.value));
  }
}

export const genres: [string, string][] = [
  ["Abilities", "2"],
  ["Action", "3"],
  ["Adaptation", "4"],
  ["Adventure", "5"],
  ["Another Chance", "6"],
  ["Apocalypse", "7"],
  ["Based On A Novel", "8"],
  ["Cheat", "9"],
  ["Comedy", "10"],
  ["Conspiracy", "11"],
  ["Cultivation", "12"],
  ["Demon", "13"],
  ["Demon King", "14"],
  ["Dragon", "15"],
  ["Drama", "16"],
  ["Drop", "17"],
  ["Dungeon", "18"],
  ["Dungeons", "19"],
  ["Fantasy", "20"],
  ["Game", "21"],
  ["Genius", "22"],
  ["Ghosts", "23"],
  ["Harem", "24"],
  ["Hero", "25"],
  ["Hidden Identity", "26"],
  ["HighFantasy", "27"],
  ["Historical", "28"],
  ["Horror", "29"],
];
