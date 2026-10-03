// Port of keiyoushi/extensions-source src/en/hiveworks/Filters.kt
import { Filter } from "../../../sdk/index.ts";

/** android.net.Uri.encode(s): everything but the unreserved characters _-!.~'()* is percent-encoded. */
const uriEncode = encodeURIComponent; // same unreserved set: A-Z a-z 0-9 - _ . ! ~ * ' ( )

/** The part of android.net.Uri.Builder these sources use: parse a URL, appendPath, appendQueryParameter, toString. */
export class UriBuilder {
  private path: string;
  private query: string;
  private readonly origin: string;
  constructor(url: string) {
    const u = new URL(url);
    this.origin = u.origin;
    this.path = u.pathname === "/" ? "" : u.pathname;
    this.query = u.search.replace(/^\?/, "");
  }
  appendPath(segment: string) {
    const encoded = uriEncode(segment);
    this.path = this.path.length === 0 ? `/${encoded}` : this.path.endsWith("/") ? this.path + encoded : `${this.path}/${encoded}`;
    return this;
  }
  appendQueryParameter(key: string, value: string) {
    this.query += `${this.query ? "&" : ""}${uriEncode(key)}=${uriEncode(value)}`;
    return this;
  }
  toString() {
    return this.origin + this.path + (this.query ? `?${this.query}` : "");
  }
}

export class OriginalsFilter extends Filter.CheckBox {
  constructor() {
    super("Original Comics");
  }
}
export class KidsFilter extends Filter.CheckBox {
  constructor() {
    super("Kids Comics");
  }
}
export class CompletedFilter extends Filter.CheckBox {
  constructor() {
    super("Completed Comics");
  }
}
export class HiatusFilter extends Filter.CheckBox {
  constructor() {
    super("On Hiatus Comics");
  }
}

export interface UriFilter {
  addToUri(uri: UriBuilder): void;
}
export const isUriFilter = (f: Filter): f is Filter & UriFilter => typeof (f as unknown as UriFilter).addToUri === "function";

export class UriSelectFilter extends Filter.Select<string> implements UriFilter {
  constructor(
    displayName: string,
    readonly uriParam: string,
    readonly vals: [string, string][],
    readonly firstIsUnspecified = true,
    defaultValue = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[1]),
      defaultValue,
    );
  }
  addToUri(uri: UriBuilder) {
    if (this.state !== 0 || !this.firstIsUnspecified) uri.appendPath(this.uriParam).appendPath(this.vals[this.state][0]);
  }
}

export class UpdateDay extends UriSelectFilter {
  constructor() {
    super("Update Day", "update-day", [
      ["all", "All"],
      ["monday", "Monday"],
      ["tuesday", "Tuesday"],
      ["wednesday", "Wednesday"],
      ["thursday", "Thursday"],
      ["friday", "Friday"],
      ["saturday", "Saturday"],
      ["sunday", "Sunday"],
    ]);
  }
}

export class RatingFilter extends UriSelectFilter {
  constructor() {
    super("Rating", "age", [
      ["all", "All"],
      ["everyone", "Everyone"],
      ["teen", "Teen"],
      ["young-adult", "Young Adult"],
      ["mature", "Mature"],
    ]);
  }
}

export class GenreFilter extends UriSelectFilter {
  constructor() {
    super("Genre", "genre", [
      ["all", "All"],
      ["action/adventure", "Action/Adventure"],
      ["animated", "Animated"],
      ["autobio", "Autobio"],
      ["comedy", "Comedy"],
      ["drama", "Drama"],
      ["dystopian", "Dystopian"],
      ["fairytale", "Fairytale"],
      ["fantasy", "Fantasy"],
      ["finished", "Finished"],
      ["historical-fiction", "Historical Fiction"],
      ["horror", "Horror"],
      ["lgbt", "LGBT"],
      ["mystery", "Mystery"],
      ["romance", "Romance"],
      ["sci-fi", "Science Fiction"],
      ["slice-of-life", "Slice of Life"],
      ["steampunk", "Steampunk"],
      ["superhero", "Superhero"],
      ["urban-fantasy", "Urban Fantasy"],
    ]);
  }
}

export class TitleFilter extends UriSelectFilter {
  constructor() {
    super("Title", "alpha", [
      ["all", "All"],
      ["a", "A"],
      ["b", "B"],
      ["c", "C"],
      ["d", "D"],
      ["e", "E"],
      ["f", "F"],
      ["g", "G"],
      ["h", "H"],
      ["i", "I"],
      ["j", "J"],
      ["k", "K"],
      ["l", "L"],
      ["m", "M"],
      ["n", "N"],
      ["o", "O"],
      ["p", "P"],
      ["q", "Q"],
      ["r", "R"],
      ["s", "S"],
      ["t", "T"],
      ["u", "U"],
      ["v", "V"],
      ["w", "W"],
      ["x", "X"],
      ["y", "Y"],
      ["z", "Z"],
      ["numbers-symbols", "Numbers / Symbols"],
    ]);
  }
}

export class SortFilter extends UriSelectFilter {
  constructor() {
    super("Sort By", "sortby", [
      ["none", "None"],
      ["a-z", "A-Z"],
      ["z-a", "Z-A"],
    ]);
  }
}
