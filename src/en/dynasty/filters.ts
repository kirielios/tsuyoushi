// Port of keiyoushi/extensions-source src/en/dynasty/Filters.kt
import { Filter } from "../../../sdk/index.ts";
import { ANTHOLOGY_TYPE, BEST_MATCH, CHAPTER_TYPE, DOUJIN_TYPE, ISSUE_TYPE, RELEASED_ON, SERIES_TYPE, SMART_SORT } from "./constants.ts";

const selectOptions: [string, string][] = [
  ["Smart", SMART_SORT], // best match for query search, release date otherwise
  ["Best Match", BEST_MATCH],
  ["Alphabetical", "name"],
  ["Date Added", "created_at"],
  ["Release Date", RELEASED_ON],
];

export class SortFilter extends Filter.Select<string> {
  constructor() {
    super(
      "Sort",
      selectOptions.map((it) => it[0]),
    );
  }
  get sort(): string {
    return selectOptions[this.state][1];
  }
}

export class TypeOption extends Filter.CheckBox {
  constructor(name: string) {
    super(name, true);
  }
}

const typeOptions = [SERIES_TYPE, CHAPTER_TYPE, ANTHOLOGY_TYPE, DOUJIN_TYPE, ISSUE_TYPE];

export class TypeFilter extends Filter.Group<TypeOption> {
  constructor() {
    super(
      "Type",
      typeOptions.map((it) => new TypeOption(it)),
    );
  }
  get checked(): string[] {
    return this.state.filter((it) => it.state).map((it) => it.name);
  }
}

/** @Serializable class Tag(id, name); tags.json also carries a permalink, ignored as upstream. */
export interface Tag {
  id: number;
  name: string;
}

export class TagCheckBox extends Filter.TriState {
  constructor(
    readonly id: number,
    name: string,
  ) {
    super(name);
  }
}

export class TagFilter extends Filter.Group<TagCheckBox> {
  constructor(tags: Tag[]) {
    super(
      "Tags",
      tags.map((it) => new TagCheckBox(it.id, it.name)),
    );
  }
  get included(): TagCheckBox[] {
    return this.state.filter((it) => it.isIncluded());
  }
  get excluded(): TagCheckBox[] {
    return this.state.filter((it) => it.isExcluded());
  }
}

export abstract class TextFilter extends Filter.Text {
  get values(): string[] {
    return this.state
      .split(",")
      .filter((it) => it.trim() !== "")
      .map((it) => it.trim())
      .map((it) => it.toLowerCase());
  }
}

export class AuthorFilter extends TextFilter {
  constructor() {
    super("Author");
  }
}

export class ScanlatorFilter extends TextFilter {
  constructor() {
    super("Scanlator");
  }
}

export class PairingFilter extends TextFilter {
  constructor() {
    super("Pairing");
  }
}
