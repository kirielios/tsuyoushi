// Port of keiyoushi/extensions-source lib-multisrc/manga18/Filters.kt
import { Filter } from "../../sdk/index.ts";

/** kotlin.Pair as kotlinx.serialization writes it. */
export interface Pair {
  first: string;
  second: string;
}

export abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: Pair[],
  ) {
    super(
      name,
      options.map((it) => it.first),
    );
  }
  get selected(): string | undefined {
    return this.options[this.state].second || undefined;
  }
}

export class TagFilter extends SelectFilter {
  constructor(tags: Pair[]) {
    super("Tags", tags);
  }
}

export class SortFilter extends SelectFilter {
  constructor() {
    super("Sort", sortValues);
  }
}

const sortValues: Pair[] = [
  { first: "Latest", second: "" },
  { first: "Views", second: "views" },
  { first: "A-Z", second: "name" },
];
