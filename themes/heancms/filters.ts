// Port of keiyoushi/extensions-source lib-multisrc/heancms/HeanCmsFilters.kt
import { Filter } from "../../sdk/index.ts";

export class Genre extends Filter.CheckBox {
  constructor(
    title: string,
    readonly id: number,
  ) {
    super(title);
  }
}

export class GenreFilter extends Filter.Group<Genre> {}

export interface Status {
  name: string;
  value: string;
}

/** EnhancedSelect<Status>: the select shows each value's toString() (its name). */
export class StatusFilter extends Filter.Select<string> {
  constructor(
    title: string,
    private readonly statuses: Status[],
  ) {
    super(
      title,
      statuses.map((it) => it.name),
    );
  }
  get selected(): Status {
    return this.statuses[this.state];
  }
}

export interface SortProperty {
  name: string;
  value: string;
}

export class SortByFilter extends Filter.Sort {
  constructor(
    title: string,
    private readonly sortProperties: SortProperty[],
  ) {
    super(
      title,
      sortProperties.map((it) => it.name),
      { index: 1, ascending: false },
    );
  }
  get selected(): string {
    return this.sortProperties[this.state!.index].value;
  }
}
