// Port of keiyoushi/extensions-source lib-multisrc/pam/Filters.kt
import { Filter } from "../../sdk/index.ts";

export class TriStateFilter extends Filter.TriState {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export abstract class TriStateGroupFilter extends Filter.Group<TriStateFilter> {
  constructor(name: string, options: [string, string][]) {
    super(
      name,
      options.map(([n, v]) => new TriStateFilter(n, v)),
    );
  }
  get included() {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.value);
  }
  get excluded() {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.value);
  }
}

export class CheckBoxFilter extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export abstract class CheckBoxGroup extends Filter.Group<CheckBoxFilter> {
  constructor(name: string, options: [string, string][]) {
    super(
      name,
      options.map(([n, v]) => new CheckBoxFilter(n, v)),
    );
  }
  get checked() {
    return this.state.filter((it) => it.state).map((it) => it.value);
  }
}

export class SortFilter extends Filter.Sort {
  constructor(
    name: string,
    private readonly sortValues: [string, string][],
    selection: { index: number; ascending: boolean } = { index: 0, ascending: false },
  ) {
    super(
      name,
      sortValues.map((it) => it[0]),
      selection,
    );
  }
  get sort() {
    return this.sortValues[this.state?.index ?? 0][1];
  }
  get ascending() {
    return this.state?.ascending ?? false;
  }
}
