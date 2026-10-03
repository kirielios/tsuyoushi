// Port of keiyoushi/extensions-source src/en/doujinio/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export interface Tag {
  id: number;
  name: string;
}

export const sortOptions: [string, string][] = [
  ["Date", "published_at"],
  ["Alphabetical", "hidden_title"],
];

export class SortFilter extends Filter.Sort {
  constructor(name = "Sort by", selection: { index: number; ascending: boolean } = { index: 0, ascending: false }) {
    super(
      name,
      sortOptions.map((it) => it[0]),
      selection,
    );
  }
  get sort(): string {
    return sortOptions[this.state!.index][1];
  }
  get order(): string {
    return this.state!.ascending ? "asc" : "desc";
  }
}

export class TagFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: number,
  ) {
    super(name, false);
  }
}

export class TagGroup extends Filter.Group<TagFilter> {
  constructor(tags: Tag[]) {
    super(
      "Tags",
      tags.map((it) => new TagFilter(it.name, it.id)),
    );
  }
  get tagIds(): number[] {
    return this.state.filter((it) => it.state).map((it) => it.id);
  }
}
