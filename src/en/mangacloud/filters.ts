// Port of keiyoushi/extensions-source src/en/mangacloud/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export abstract class SelectFilter extends Filter.Select<string | null> {
  private readonly options: [string, string | null][];
  constructor(name: string, options: [string, string | null][]) {
    super(
      name,
      options.map((it) => it[0]),
    );
    this.options = options;
  }
  get selected(): string | null {
    return this.options[this.state][1];
  }
}

export class TriStateFilter extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class TriStateGroupFilter extends Filter.Group<TriStateFilter> {
  constructor(name: string, options: [string, string][]) {
    super(
      name,
      options.map((it) => new TriStateFilter(it[0], it[1])),
    );
  }
  get included() {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.value);
  }
  get excluded() {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.value);
  }
}

export class TypeFilter extends SelectFilter {
  constructor() {
    super("Type", [
      ["Any", null],
      ["Manga", "Manga"],
      ["Manhua", "Manhua"],
      ["Manhwa", "Manhwa"],
    ]);
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super("Status", [
      ["Any", null],
      ["Ongoing", "Ongoing"],
      ["Completed", "Completed"],
      ["Cancelled", "Cancelled"],
      ["Hiatus", "Hiatus"],
      ["Unknown", "Unknown"],
    ]);
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort by", [
      ["None", null],
      ["Latest Chapter", "chapter_date-DESC"],
      ["Oldest Chapter", "chapter_date-ASC"],
      ["Title Ascending", "title-ASC"],
      ["Title Descending", "title-DESC"],
      ["Recently Added", "created_date-DESC"],
      ["Oldest Added", "created_date-ASC"],
    ]);
  }
}
