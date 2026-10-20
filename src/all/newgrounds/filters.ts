// Port of yuzono/anime-extensions src/all/newgrounds/NewGroundsFilters.kt
import { Filter } from "../../../sdk/index.ts";

export const MATCH_AGAINST: Record<string, string> = {
  Default: "",
  "title / description / tags / author": "tdtu",
  "title / description / tags": "tdt",
  "title / description": "td",
  title: "t",
  description: "d",
};

export const GENRE: Record<string, string> = {
  All: "",
  Action: "45",
  "Comedy - Original": "60",
  "Comedy - Parody": "61",
  Drama: "47",
  Experimental: "49",
  Informative: "48",
  "Music Video": "50",
  Other: "51",
  Spam: "55",
};

export const SORTING: Record<string, string> = {
  "Default (Relevance)": "relevance",
  Date: "date",
  Score: "score",
  Views: "views",
};

export class MatchAgainstFilter extends Filter.Select<string> {
  constructor() {
    super("Match against", Object.keys(MATCH_AGAINST), 0);
  }
}

export class TuningExactFilter extends Filter.CheckBox {
  constructor() {
    super("exact matches", false);
  }
}
export class TuningAnyFilter extends Filter.CheckBox {
  constructor() {
    super("match any words", false);
  }
}
export class TuningFilterGroup extends Filter.Group<Filter.CheckBox> {
  constructor() {
    super("Tuning", [new TuningExactFilter(), new TuningAnyFilter()]);
  }
}

export class AuthorFilter extends Filter.Text {
  constructor() {
    super("Author");
  }
}

export class GenreFilter extends Filter.Select<string> {
  constructor() {
    super("Genre", Object.keys(GENRE));
  }
}

export class MinLengthFilter extends Filter.Text {
  constructor() {
    super("Min Length");
  }
}
export class MaxLengthFilter extends Filter.Text {
  constructor() {
    super("Max Length");
  }
}
export class LengthFilterGroup extends Filter.Group<Filter.Text> {
  constructor() {
    super("Length (00:00:00)", [new MinLengthFilter(), new MaxLengthFilter()]);
  }
}

export class FrontpagedFilter extends Filter.CheckBox {
  constructor() {
    super("Frontpaged?", false);
  }
}

export class AfterDateFilter extends Filter.Text {
  constructor() {
    super("On, or after");
  }
}
export class BeforeDateFilter extends Filter.Text {
  constructor() {
    super("Before");
  }
}
export class DateFilterGroup extends Filter.Group<Filter.Text> {
  constructor() {
    super("Date (YYYY-MM-DD)", [new AfterDateFilter(), new BeforeDateFilter()]);
  }
}

export class SortingFilter extends Filter.Sort {
  constructor() {
    super("Sort by", Object.keys(SORTING), { index: 0, ascending: true });
  }
}

export class TagsFilter extends Filter.Text {
  constructor() {
    super("Tags (comma separated)");
  }
}
