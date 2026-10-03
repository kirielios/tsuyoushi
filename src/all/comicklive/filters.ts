// Port of keiyoushi/extensions-source src/all/comicklive/Filters.kt
import { Filter } from "../../../sdk/index.ts";
import type { MetadataName } from "./dto.ts";

const byName = (a: MetadataName, b: MetadataName) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  get selected(): string | null {
    return this.options[this.state][1] || null;
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

export abstract class CheckBoxGroup extends Filter.Group<CheckBoxFilter> {
  constructor(name: string, options: [string, string][]) {
    super(
      name,
      options.map((it) => new CheckBoxFilter(it[0], it[1])),
    );
  }
  get checked() {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
}

export class TriStateFilter extends Filter.TriState {
  constructor(
    name: string,
    readonly slug: string,
  ) {
    super(name);
  }
}

export abstract class TriStateGroupFilter extends Filter.Group<TriStateFilter> {
  constructor(name: string, options: [string, string][]) {
    super(
      name,
      options.map((it) => new TriStateFilter(it[0], it[1])),
    );
  }
  get included() {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.slug);
  }
  get excluded() {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.slug);
  }
}

const getSortsList: [string, string][] = [
  ["Latest", "created_at"],
  ["Popular", "user_follow_count"],
  ["Highest Rating", "rating"],
  ["Last Uploaded", "uploaded"],
];

export class SortFilter extends Filter.Sort {
  constructor() {
    super(
      "Sort",
      getSortsList.map((it) => it[0]),
      { index: 0, ascending: false },
    );
  }
  get selected(): string | null {
    const v = this.state ? getSortsList[this.state.index][1] : null;
    return v ? v : null;
  }
}

export class GenreFilter extends TriStateGroupFilter {
  constructor(genres: MetadataName[]) {
    super(
      "Genre",
      [...genres].sort(byName).map((it) => [it.name, it.slug]),
    );
  }
}

export class TagFilter extends TriStateGroupFilter {
  constructor(letter: string, tags: MetadataName[]) {
    super(
      letter,
      [...tags].sort(byName).map((it) => [it.name, it.slug]),
    );
  }
}

export class TagFilters extends Filter.Group<TagFilter> {
  constructor(tags: MetadataName[]) {
    const groups = new Map<string, MetadataName[]>();
    for (const it of [...tags].sort(byName)) {
      const c = it.name.charAt(0).toUpperCase() || null;
      const key = c == null || !(c >= "A" && c <= "Z") ? "#" : c;
      groups.set(key, [...(groups.get(key) ?? []), it]);
    }
    super(
      "Tags",
      [...groups].map(([letter, tagsChunk]) => new TagFilter(letter, tagsChunk)),
    );
  }
}

export class TagFilterText extends Filter.Text {
  constructor() {
    super("Tags");
  }
}

export class DemographicFilter extends CheckBoxGroup {
  constructor() {
    super("Demographic", [
      ["Shounen", "1"],
      ["Josei", "2"],
      ["Seinen", "3"],
      ["Shoujo", "4"],
      ["None", "0"],
    ]);
  }
}

export class CreatedAtFilter extends SelectFilter {
  constructor() {
    super("Created At", [
      ["", ""],
      ["3 days ago", "3"],
      ["7 days ago", "7"],
      ["30 days ago", "30"],
      ["3 months ago", "90"],
      ["6 months ago", "180"],
      ["1 year ago", "365"],
      ["2 years ago", "730"],
    ]);
  }
}

export class TypeFilter extends CheckBoxGroup {
  constructor() {
    super("Type", [
      ["Manga", "jp"],
      ["Manhwa", "kr"],
      ["Manhua", "cn"],
      ["Others", "others"],
    ]);
  }
}

export class MinimumChaptersFilter extends Filter.Text {
  constructor() {
    super("Minimum Chapters");
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["", ""],
      ["Ongoing", "1"],
      ["Completed", "2"],
      ["Cancelled", "3"],
      ["Hiatus", "4"],
    ]);
  }
}

export class ContentRatingFilter extends SelectFilter {
  constructor() {
    super("Content Rating", [
      ["", ""],
      ["Safe", "safe"],
      ["Suggestive", "suggestive"],
      ["Erotica", "erotica"],
    ]);
  }
}

function years(): [string, string][] {
  const out: [string, string][] = [["", ""]];
  for (let y = new Date().getFullYear(); y >= 1990; y--) out.push([`${y}`, String(y)]);
  out.push(["Before 1990", "0"]);
  return out;
}

export class ReleaseFrom extends SelectFilter {
  constructor() {
    super("Release From", years());
  }
}

export class ReleaseTo extends SelectFilter {
  constructor() {
    super("Release To", years());
  }
}
