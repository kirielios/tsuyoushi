// Port of keiyoushi/extensions-source lib-multisrc/madara/Filters.kt and Models.kt
import { Filter } from "../../sdk/index.ts";

export interface GenreRoute {
  name: string;
  slug: string;
  path: string;
}
/** JsonElement?.genreRoutes() */
export const genreRoutes = (data: unknown): GenreRoute[] => (Array.isArray(data) ? (data as GenreRoute[]) : []);

export interface ChapterProtectorData {
  ct: string; // ciphertext
  s: string; // salt
}

export class TextFilter extends Filter.Text {
  constructor(
    name: string,
    readonly taxonomy: string,
  ) {
    super(name);
  }
}

export class StatusTag extends Filter.CheckBox {
  constructor(
    name: string,
    readonly slug: string,
  ) {
    super(name);
  }
}

export class StatusFilter extends Filter.Group<StatusTag> {
  constructor(name: string, options: [string, string][]) {
    super(
      name,
      options.map(([n, slug]) => new StatusTag(n, slug)),
    );
  }
}

export class SortFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, string][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  key() {
    return this.options[this.state][1];
  }
}

export class AdultFilter extends Filter.Select<string> {
  constructor(name: string, options: [string, string][]) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
}

export class GenreConditionFilter extends Filter.Select<string> {
  constructor(name: string, options: [string, string][]) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
}

export class GenreCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly slug: string,
  ) {
    super(name);
  }
}

export class GenreList extends Filter.Group<GenreCheckBox> {
  constructor(name: string, genres: GenreRoute[]) {
    super(
      name,
      genres.map((it) => new GenreCheckBox(it.name, it.slug)),
    );
  }
}

export class SingleGenreFilter extends Filter.Select<string> {
  constructor(
    name: string,
    allLabel: string,
    private readonly genres: GenreRoute[],
  ) {
    super(name, [allLabel, ...genres.map((it) => it.name)]);
  }
  route(): GenreRoute | undefined {
    return this.genres[this.state - 1];
  }
}
