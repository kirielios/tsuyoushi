// Mihon's Filter hierarchy. `filter instanceof Filter.Select` stands in for Kotlin's `is Filter.Select`.
// `kind` is the contract with the app: bundles are minified, so class names cannot identify a filter over there.

export type FilterKind = "header" | "separator" | "select" | "text" | "checkbox" | "tristate" | "group" | "sort";

export abstract class Filter<T = unknown> {
  abstract readonly kind: FilterKind;
  constructor(
    readonly name: string,
    public state: T,
  ) {}
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Filter {
  export class Header extends Filter<null> {
    readonly kind = "header";
    constructor(name: string) {
      super(name, null);
    }
  }
  export class Separator extends Filter<null> {
    readonly kind = "separator";
    constructor(name = "") {
      super(name, null);
    }
  }
  export class Select<V = string> extends Filter<number> {
    readonly kind = "select";
    constructor(
      name: string,
      readonly values: V[],
      state = 0,
    ) {
      super(name, state);
    }
  }
  export class Text extends Filter<string> {
    readonly kind = "text";
    constructor(name: string, state = "") {
      super(name, state);
    }
  }
  export class CheckBox extends Filter<boolean> {
    readonly kind = "checkbox";
    constructor(name: string, state = false) {
      super(name, state);
    }
  }
  export class TriState extends Filter<number> {
    readonly kind = "tristate";
    static readonly STATE_IGNORE = 0;
    static readonly STATE_INCLUDE = 1;
    static readonly STATE_EXCLUDE = 2;
    constructor(name: string, state = 0) {
      super(name, state);
    }
    isIgnored = () => this.state === TriState.STATE_IGNORE;
    isIncluded = () => this.state === TriState.STATE_INCLUDE;
    isExcluded = () => this.state === TriState.STATE_EXCLUDE;
  }
  export class Group<V extends Filter = Filter> extends Filter<V[]> {
    readonly kind = "group";
    constructor(name: string, state: V[]) {
      super(name, state);
    }
  }
  export class Sort extends Filter<{ index: number; ascending: boolean } | null> {
    readonly kind = "sort";
    constructor(
      name: string,
      readonly values: string[],
      state: { index: number; ascending: boolean } | null = null,
    ) {
      super(name, state);
    }
  }
}

export type FilterList = Filter[];
export const FilterList = (...filters: Filter[]): FilterList => filters;
/** keiyoushi's filters.firstInstanceOrNull<T>() */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const firstInstanceOrNull = <T>(filters: FilterList, cls: abstract new (...args: any[]) => T): T | null => (filters.find((f) => f instanceof cls) as T | undefined) ?? null;
/** keiyoushi's filters.firstInstance<T>(): throws when absent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const firstInstance = <T>(filters: FilterList, cls: abstract new (...args: any[]) => T): T => {
  const f = firstInstanceOrNull(filters, cls);
  if (f === null) throw new Error(`No ${cls.name} in filter list`);
  return f;
};
