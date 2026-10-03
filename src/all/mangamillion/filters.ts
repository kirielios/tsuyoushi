// Port of keiyoushi/extensions-source src/all/mangamillion/Filters.kt
import { Filter } from "../../../sdk/index.ts";
import type { Tag } from "./dto.ts";

export class TagCheckBox extends Filter.CheckBox {
  constructor(
    readonly id: number,
    name: string,
  ) {
    super(name);
  }
}

export class TagGroup extends Filter.Group<TagCheckBox> {
  constructor(name: string, tags: Tag[]) {
    super(
      name,
      tags.map((it) => new TagCheckBox(it.id, it.name)),
    );
  }
  get checkedIds(): number[] {
    return this.state.filter((it) => it.state).map((it) => it.id);
  }
}

export class TagIdGroup extends TagGroup {}

export class GenreFilter extends TagIdGroup {
  constructor(tags: Tag[]) {
    super("Genre", tags);
  }
}

export class ThemeFilter extends TagIdGroup {
  constructor(tags: Tag[]) {
    super("Theme", tags);
  }
}

export class HighlightsFilter extends TagIdGroup {
  constructor(tags: Tag[]) {
    super("Highlights", tags);
  }
}

export class RatingFilter extends TagGroup {
  constructor(tags: Tag[]) {
    super("Rating", tags);
  }
}
