// Port of keiyoushi/extensions-source src/all/webtoons/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string | null][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  get selected() {
    return this.options[this.state][1];
  }
}

export class SearchType extends SelectFilter {
  constructor() {
    super("Search Type", [
      ["ALL", null],
      ["Originals", "originals"],
      ["Canvas", "canvas"],
    ]);
  }
}
