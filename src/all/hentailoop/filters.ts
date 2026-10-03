// Port of keiyoushi/extensions-source src/all/hentailoop/Filters.kt
import { Filter, type FilterList } from "../../../sdk/index.ts";
import type { SourceFilter } from "./dto.ts";

const sortValues: [string, string][] = [
  ["Views", "views"],
  ["Date", "date"],
  ["Likes", "likes"],
  ["Dislikes", "dislikes"],
];

export class SortFilter extends Filter.Select<string> {
  constructor() {
    super(
      "Sort",
      sortValues.map((it) => it[0]),
    );
  }
  get sort() {
    return sortValues[this.state][1];
  }
}

export class CheckBoxFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: SourceFilter,
  ) {
    super(name);
  }
}

export class GenreFilter extends Filter.Group<CheckBoxFilter> {
  constructor(values: SourceFilter[]) {
    super(
      "Genre",
      values.map((it) => new CheckBoxFilter(it.name, it)),
    );
  }
  get checked() {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
}

export class ReleaseFilter extends Filter.Select<string> {
  constructor(readonly releases: SourceFilter[]) {
    super("Release", ["", ...releases.map((it) => it.name)]);
  }
  get release() {
    return this.releases.find((it) => it.name === this.values[this.state]);
  }
}

export class TriState extends Filter.TriState {
  constructor(
    name: string,
    readonly value: SourceFilter,
  ) {
    super(name);
  }
}

export class TriStateFilter extends Filter.Group<TriState> {
  constructor(name: string, values: SourceFilter[]) {
    super(
      name,
      values.map((it) => new TriState(it.name, it)),
    );
  }
  get included() {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.value);
  }
  get excluded() {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.value);
  }
}

export class TagFilter extends TriStateFilter {
  constructor(values: SourceFilter[]) {
    super("Tags", values);
  }
}
export class ParodyFilter extends TriStateFilter {
  constructor(values: SourceFilter[]) {
    super("Parodies", values);
  }
}
export class ArtistFilter extends TriStateFilter {
  constructor(values: SourceFilter[]) {
    super("Artists", values);
  }
}
export class CharacterFilter extends TriStateFilter {
  constructor(values: SourceFilter[]) {
    super("Characters", values);
  }
}
export class CircleFilter extends TriStateFilter {
  constructor(values: SourceFilter[]) {
    super("Circles", values);
  }
}
export class ConventionFilter extends TriStateFilter {
  constructor(values: SourceFilter[]) {
    super("Conventions", values);
  }
}
export class LanguageFilter extends TriStateFilter {
  constructor(values: SourceFilter[]) {
    super("Languages", values);
  }
}

export class PageCountFilter extends Filter.Text {
  get count(): number {
    // String.toIntOrNull()
    const it = /^[+-]?\d+$/.test(this.state) && Math.abs(Number(this.state)) <= 2 ** 31 ? Number.parseInt(this.state, 10) : null;
    if (it == null || it < 0) throw new Error("Page Count must be a positive integer");
    return it;
  }
}

export class MinPageCount extends PageCountFilter {
  constructor() {
    super("Minimum Pages", "0");
  }
}
export class MaxPageCount extends PageCountFilter {
  constructor() {
    super("Maximum Pages", "2000");
  }
}

export class UncensoredFilter extends Filter.CheckBox {
  constructor() {
    super("Only Uncensored", false);
  }
}

/** FilterList.findActiveFilter(): the single directory filter in use, null when several filters are active. */
export function findActiveFilter(list: FilterList): [string, string | null] | null {
  let activeDirectory: [string, string | null] | null = null;

  for (const f of list) {
    if (f instanceof SortFilter) continue;
    else if (f instanceof TriStateFilter) {
      if (f.included.length === 1 && f.excluded.length === 0) {
        if (activeDirectory != null) return null;
        let directory: string;
        if (f instanceof TagFilter) directory = "tag";
        else if (f instanceof ParodyFilter) directory = "parodies";
        else if (f instanceof ArtistFilter) directory = "artists";
        else if (f instanceof CharacterFilter) directory = "characters";
        else if (f instanceof CircleFilter) directory = "circles";
        else if (f instanceof ConventionFilter) directory = "conventions";
        else if (f instanceof LanguageFilter) directory = "languages";
        else return null;
        activeDirectory = [directory, f.included[0].slug];
      } else if (f.included.length === 0 && f.excluded.length === 0) continue;
      else return null;
    } else if (f instanceof GenreFilter) {
      if (f.checked.length === 1) {
        if (activeDirectory != null) return null;
        activeDirectory = ["genres", f.checked[0].slug];
      } else if (f.checked.length === 0) continue;
      else return null;
    } else if (f instanceof ReleaseFilter) {
      if (f.state !== 0) {
        if (activeDirectory != null) return null;
        const slug = f.release?.slug;
        if (slug === undefined) return null;
        activeDirectory = ["releases", slug];
      }
    } else if (f instanceof MinPageCount) {
      if (f.count !== 0) return null;
    } else if (f instanceof MaxPageCount) {
      if (f.count !== 2000) return null;
    } else if (f instanceof UncensoredFilter) {
      if (f.state) return null;
    } else throw new Error("unknown filter");
  }

  return activeDirectory ?? ["manga", null];
}
