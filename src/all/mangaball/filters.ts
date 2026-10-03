// Port of keiyoushi/extensions-source src/all/mangaball/Filters.kt
import { Filter } from "../../../sdk/index.ts";

export abstract class SelectFilter<T> extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: [string, T][],
  ) {
    super(
      name,
      options.map((it) => it[0]),
    );
  }
  get selected(): T {
    return this.options[this.state][1];
  }
}

export class TriStateFilter<T> extends Filter.TriState {
  constructor(
    name: string,
    readonly value: T,
  ) {
    super(name);
  }
}

export abstract class TriStateGroupFilter<T> extends Filter.Group<TriStateFilter<T>> {
  constructor(name: string, options: [string, T][]) {
    super(
      name,
      options.map((it) => new TriStateFilter(it[0], it[1])),
    );
  }
  get included(): T[] {
    return this.state.filter((it) => it.isIncluded()).map((it) => it.value);
  }
  get excluded(): T[] {
    return this.state.filter((it) => it.isExcluded()).map((it) => it.value);
  }
}

export class SortFilter extends Filter.Sort {
  constructor() {
    super("Sort By", ["Latest Updated", "Most Viewed", "Top Rated", "Recently Added", "Title"], { index: 0, ascending: false });
  }
  get sortBy(): string {
    return SORT_BY[this.state?.index ?? 0];
  }
  get sortOrder(): string {
    return this.state?.ascending === true ? "asc" : "desc";
  }
}
const SORT_BY = ["lastupdate", "views", "rating", "created_at", "name"];

export class TypeFilter extends SelectFilter<string> {
  constructor() {
    super("Type", [
      ["All", ""],
      ["Manga", "manga"],
      ["Manhwa", "manhwa"],
      ["Manhua", "manhua"],
      ["Comics", "comics"],
    ]);
  }
}

export class DemographicFilter extends SelectFilter<string> {
  constructor() {
    super("Magazine Demographic", [
      ["All", ""],
      ["Shounen", "shounen"],
      ["Shoujo", "shoujo"],
      ["Seinen", "seinen"],
      ["Josei", "josei"],
    ]);
  }
}

export class StatusFilter extends SelectFilter<string> {
  constructor() {
    super("Publication Status", [
      ["All", ""],
      ["Ongoing", "ongoing"],
      ["Completed", "completed"],
      ["Hiatus", "hiatus"],
      ["Cancelled", "cancelled"],
    ]);
  }
}

export class TagModeFilter extends SelectFilter<string> {
  constructor() {
    super("Tag Mode", [
      ["AND", "AND"],
      ["OR", "OR"],
    ]);
  }
}

export class ContentFilter extends TriStateGroupFilter<string> {
  constructor() {
    super("Content", [
      ["Gore", "685148d115e8b86aae68e4f3"],
      ["Sexual Violence", "685146c5f3ed681c80f257e7"],
    ]);
  }
}

export class FormatFilter extends TriStateGroupFilter<string> {
  constructor() {
    super("Format", [
      ["4-Koma", "685148d115e8b86aae68e4ec"],
      ["Adaptation", "685148cf15e8b86aae68e4de"],
      ["Anthology", "685148e915e8b86aae68e558"],
      ["Award Winning", "685148fe15e8b86aae68e5a7"],
      ["Doujinshi", "6851490e15e8b86aae68e5da"],
      ["Fan Colored", "6851498215e8b86aae68e704"],
      ["Full Color", "685148d615e8b86aae68e502"],
      ["Long Strip", "685148d915e8b86aae68e517"],
      ["Official Colored", "6851493515e8b86aae68e64a"],
      ["Oneshot", "685148eb15e8b86aae68e56c"],
      ["Self-Published", "6851492e15e8b86aae68e633"],
      ["Web Comic", "685148d715e8b86aae68e50d"],
    ]);
  }
}

export class GenreFilter extends TriStateGroupFilter<string> {
  constructor() {
    super("Genre", [
      ["Action", "685146c5f3ed681c80f257e3"],
      ["Adult", "689371f0a943baf927094f03"],
      ["Adventure", "685146c5f3ed681c80f257e6"],
      ["Boys' Love", "685148ef15e8b86aae68e573"],
      ["Comic", "68ecab8507ec62d87e62780f"],
      ["Comedy", "685146c5f3ed681c80f257e5"],
      ["Crime", "685148da15e8b86aae68e51f"],
      ["Drama", "685148cf15e8b86aae68e4dd"],
      ["Ecchi", "6892a73ba943baf927094e37"],
      ["Fantasy", "685146c5f3ed681c80f257ea"],
      ["Girls' Love", "685148da15e8b86aae68e524"],
      ["Historical", "685148db15e8b86aae68e527"],
      ["Horror", "685148da15e8b86aae68e520"],
      ["Isekai", "685146c5f3ed681c80f257e9"],
      ["Josei(W)", "694cc2d9f8014f5e0a63ac73"],
      ["Magical Girls", "6851490d15e8b86aae68e5d4"],
      ["Manga", "68ecab1e07ec62d87e627806"],
      ["Manhua", "68ecab4807ec62d87e62780b"],
      ["Manhwa", "68ecab3b07ec62d87e627809"],
      ["Mature", "68932d11a943baf927094e7b"],
      ["Mecha", "6851490c15e8b86aae68e5d2"],
      ["Medical", "6851494e15e8b86aae68e66e"],
      ["Mystery", "685148d215e8b86aae68e4f4"],
      ["Philosophical", "685148e215e8b86aae68e544"],
      ["Psychological", "685148d715e8b86aae68e507"],
      ["Revenge", "694cc2d9f8014f5e0a63ac75"],
      ["Romance", "685148cf15e8b86aae68e4db"],
      ["Sci-Fi", "685148cf15e8b86aae68e4da"],
      ["Shoujo(G)", "694cc2d9f8014f5e0a63ac74"],
      ["Shounen Ai", "689f0ab1f2e66744c6091524"],
      ["Slice of Life", "685148d015e8b86aae68e4e3"],
      ["Smut", "689371f2a943baf927094f04"],
      ["Sports", "685148f515e8b86aae68e588"],
      ["Superhero", "6851492915e8b86aae68e61c"],
      ["Thriller", "685148d915e8b86aae68e51e"],
      ["Tragedy", "685148db15e8b86aae68e529"],
      ["User Created", "68932c3ea943baf927094e77"],
      ["Wuxia", "6851490715e8b86aae68e5c3"],
      ["Yaoi", "68932f68a943baf927094eaa"],
      ["Yuri", "6896a885a943baf927094f66"],
    ]);
  }
}

export class ThemeFilter extends TriStateGroupFilter<string> {
  constructor() {
    super("Theme", [
      ["3D", "6a0026ba63a8d384c0a4be13"],
      ["Aliens", "6851490d15e8b86aae68e5d5"],
      ["Animals", "685148e715e8b86aae68e54b"],
      ["Comics", "68bf09ff8fdeab0b6a9bc2b7"],
      ["Cooking", "685148d215e8b86aae68e4f8"],
      ["Crossdressing", "685148df15e8b86aae68e534"],
      ["Delinquents", "685148d915e8b86aae68e519"],
      ["Demons", "685146c5f3ed681c80f257e4"],
      ["Genderswap", "685148d715e8b86aae68e505"],
      ["Ghosts", "685148d615e8b86aae68e501"],
      ["Gyaru", "685148d015e8b86aae68e4e8"],
      ["Harem", "685146c5f3ed681c80f257e8"],
      ["Hentai", "68bfceaf4dbc442a26519889"],
      ["Incest", "685148f215e8b86aae68e584"],
      ["Loli", "685148d715e8b86aae68e506"],
      ["Mafia", "685148d915e8b86aae68e518"],
      ["Magic", "685148d715e8b86aae68e509"],
      ["Manhwa 18+", "68f5f5ce5f29d3c1863dec3a"],
      ["Martial Arts", "6851490615e8b86aae68e5c2"],
      ["Military", "685148e215e8b86aae68e541"],
      ["Monster Girls", "685148db15e8b86aae68e52c"],
      ["Monsters", "685146c5f3ed681c80f257e2"],
      ["Music", "685148d015e8b86aae68e4e4"],
      ["Ninja", "685148d715e8b86aae68e508"],
      ["Office Workers", "685148d315e8b86aae68e4fd"],
      ["Police", "6851498815e8b86aae68e714"],
      ["Post-Apocalyptic", "685148e215e8b86aae68e540"],
      ["Reincarnation", "685146c5f3ed681c80f257e1"],
      ["Reverse Harem", "685148df15e8b86aae68e533"],
      ["Samurai", "6851490415e8b86aae68e5b9"],
      ["School Life", "685148d015e8b86aae68e4e7"],
      ["Seinen", "6a0025c263a8d384c0a4be07"],
      ["Shota", "685148d115e8b86aae68e4ed"],
      ["Supernatural", "685148db15e8b86aae68e528"],
      ["Survival", "685148cf15e8b86aae68e4dc"],
      ["Time Travel", "6851490c15e8b86aae68e5d1"],
      ["Traditional Games", "6851493515e8b86aae68e645"],
      ["Vampires", "685148f915e8b86aae68e597"],
      ["Video Games", "685148e115e8b86aae68e53c"],
      ["Villainess", "6851492115e8b86aae68e602"],
      ["Virtual Reality", "68514a1115e8b86aae68e83e"],
      ["Zombies", "6851490c15e8b86aae68e5d3"],
    ]);
  }
}
