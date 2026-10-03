// Port of keiyoushi/extensions-source lib-multisrc/ezmanhwa/EZManhwaFilters.kt
import { Filter } from "../../sdk/index.ts";

export class EZManhwaSortFilter extends Filter.Select<string> {
  private static readonly VALUES = ["latest", "popular", "newest", "alphabetical"];
  static readonly DISPLAY = ["Latest", "Popular", "Newest", "Alphabetical"];
  constructor() {
    super("Sort", EZManhwaSortFilter.DISPLAY);
  }
  get value() {
    return EZManhwaSortFilter.VALUES[this.state];
  }
}

export class EZManhwaStatusFilter extends Filter.Select<string> {
  private static readonly VALUES = ["", "ONGOING", "COMPLETED", "HIATUS", "DROPPED"];
  static readonly DISPLAY = ["All", "Ongoing", "Completed", "Hiatus", "Dropped"];
  constructor() {
    super("Status", EZManhwaStatusFilter.DISPLAY);
  }
  get value() {
    return EZManhwaStatusFilter.VALUES[this.state];
  }
}

export class EZManhwaTypeFilter extends Filter.Select<string> {
  private static readonly VALUES = ["", "MANGA", "MANHWA", "MANHUA"];
  static readonly DISPLAY = ["All", "Manga", "Manhwa", "Manhua"];
  constructor() {
    super("Type", EZManhwaTypeFilter.DISPLAY);
  }
  get value() {
    return EZManhwaTypeFilter.VALUES[this.state];
  }
}
