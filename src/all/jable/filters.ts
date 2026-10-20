// Port of yuzono/anime-extensions src/all/jable/JableFilters.kt
import { Filter } from "../../../sdk/index.ts";

export class BlockFunction {
  constructor(
    readonly name: string,
    readonly blockId: string,
    readonly functionName = "get_block",
  ) {}
}

export class BlockFunctionFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly functions: BlockFunction[],
  ) {
    super(
      name,
      functions.map((it) => it.name),
    );
  }
  get selected() {
    return this.functions[this.state];
  }
}

export class UriPartFilter extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly pairs: [string, string][],
  ) {
    super(
      name,
      pairs.map((it) => it[0]),
    );
  }
  get selected() {
    return this.pairs[this.state];
  }
}

export class SortFilter extends UriPartFilter {}

export class TagFilter extends UriPartFilter {}
