// Port of keiyoushi/extensions-source src/all/simplyhentai/SimplyHentaiFilters.kt
import { Filter } from "../../../sdk/index.ts";

export class SortFilter extends Filter.Select<string> {
  static readonly labels = ["Relevance", "Upload Date", "Popularity"];
  readonly orders = ["", "upload-date", "popularity"];
  constructor(values: string[] = SortFilter.labels) {
    super("Sort by", values);
  }
}

export class SeriesFilter extends Filter.Text {
  constructor() {
    super("Series");
  }
  get value(): string | null {
    return this.state.trim() === "" ? null : this.state;
  }
}

abstract class CommaListFilter extends Filter.Text {
  get value(): string[] | null {
    return this.state.trim() === "" ? null : this.state.split(",");
  }
}

export class TagsFilter extends CommaListFilter {
  constructor() {
    super("Tags");
  }
}

export class ArtistsFilter extends CommaListFilter {
  constructor() {
    super("Artists");
  }
}

export class TranslatorsFilter extends CommaListFilter {
  constructor() {
    super("Translators");
  }
}

export class CharactersFilter extends CommaListFilter {
  constructor() {
    super("Characters");
  }
}

export class Note extends Filter.Header {
  constructor(type: string) {
    super(`Separate multiple ${type} with commas (,)`);
  }
}
