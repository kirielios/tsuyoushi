// Port of keiyoushi/extensions-source src/en/templescan/Filters.kt
import { Filter, FilterList } from "../../../sdk/index.ts";

export abstract class SelectFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
    defaultValue: string | null = null,
  ) {
    super(
      name,
      options.map((it) => it[0]),
      Math.max(
        options.findIndex((it) => it[1] === defaultValue),
        0,
      ),
    );
  }
  get selected(): string | null {
    const v = this.options[this.state][1];
    return v.trim() ? v : null;
  }
}

export class StatusFilter extends SelectFilter {
  constructor() {
    super(
      "Status",
      ["", "Ongoing", "Hiatus", "Completed", "Canceled", "Dropped"].map((it) => [it, it] as [string, string]),
    );
  }
}

export class OrderFilter extends SelectFilter {
  constructor(def: string | null = null) {
    super(
      "Order by",
      [
        ["Update Chapter", "updated"],
        ["Created At", "created"],
        ["Trending", "views"],
      ],
      def,
    );
  }
  static get POPULAR() {
    return FilterList(new OrderFilter("views"));
  }
  static get LATEST() {
    return FilterList(new OrderFilter("updated"));
  }
}

export const getFilters = () => FilterList(new StatusFilter(), new OrderFilter());
