// Port of keiyoushi/extensions-source src/all/cosplaytele/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly valuePair: [string, string][],
  ) {
    super(displayName, valuePair.map((it) => it[0]));
  }
  toUriPart = () => this.valuePair[this.state][1];
}

export const CATEGORIES: [string, string][] = [
  ["All", ""],
  ["Cosplay Nude", "category/nude"],
  ["Cosplay Ero", "category/no-nude"],
  ["Cosplay", "category/cosplay"],
];
