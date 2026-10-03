// Port of keiyoushi/extensions-source src/all/danbooru/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class FilterTags extends Filter.Text {
  constructor() {
    super("Tags");
  }
}
export class FilterDescription extends Filter.Text {
  constructor() {
    super("Description");
  }
}
export class FilterIsDeleted extends Filter.CheckBox {
  constructor() {
    super("Deleted");
  }
}

export class FilterCategory extends Filter.Select<string> {
  static readonly values = ["", "Series", "Collection"];
  static readonly keys = ["", "series", "collection"];
  constructor() {
    super("Category", FilterCategory.values, 1);
  }
  get selected(): string {
    return FilterCategory.keys[this.state];
  }
}

export class FilterOrder extends Filter.Sort {
  static readonly values = ["Last updated", "Name", "Recently created", "Post count"];
  static readonly keys = ["updated_at", "name", "created_at", "post_count"];
  constructor() {
    super("Order", FilterOrder.values, { index: 0, ascending: false });
  }
  get selected(): string | null {
    return this.state ? FilterOrder.keys[this.state.index] : null;
  }
}

export function filterOrder(key: string | null, ascending = false): FilterOrder {
  const f = new FilterOrder();
  f.state = { index: FilterOrder.keys.indexOf(key as string), ascending };
  return f;
}
