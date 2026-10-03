// Port of keiyoushi/extensions-source lib-multisrc/madaralegacy/Madara.kt (filter classes)
import { Filter } from "../../sdk/index.ts";

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string][],
    state = 0,
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
      state,
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
}

export class Tag extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string,
  ) {
    super(name);
  }
}

export class AuthorFilter extends Filter.Text {}
export class ArtistFilter extends Filter.Text {}
export class YearFilter extends Filter.Text {}
export class StatusFilter extends Filter.Group<Tag> {}
export class OrderByFilter extends UriPartFilter {}
export class GenreConditionFilter extends UriPartFilter {}
export class AdultContentFilter extends UriPartFilter {}

export class GenreCheckBox extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string = name,
  ) {
    super(name);
  }
}
export interface Genre {
  name: string;
  id: string;
}
export class GenreList extends Filter.Group<GenreCheckBox> {
  constructor(title: string, genres: Genre[]) {
    super(
      title,
      genres.map((it) => new GenreCheckBox(it.name, it.id)),
    );
  }
}
