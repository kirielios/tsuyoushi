// Port of keiyoushi/extensions-source src/all/mangaplus/Filters.kt
import { Filter } from "../../../sdk/index.ts";
import type { TagName } from "./dto.ts";

const TYPES = ["serializing", "completed", "one-shot"];

export class TypeFilter extends Filter.Select<string> {
  static readonly DEFAULT_TYPE = "serializing";
  constructor() {
    super("Status", ["Serializing", "Completed", "One-shot"]);
  }
  get type(): string {
    return TYPES[this.state];
  }
  get isDefault(): boolean {
    return this.state === 0;
  }
}

export class GenreFilter extends Filter.Select<string> {
  private readonly slugs: string[];
  constructor(genres: TagName[]) {
    super("Genre", ["All", ...genres.map((it) => it.name ?? "")]);
    this.slugs = ["", ...genres.map((it) => it.slug ?? "")];
  }
  get slug(): string {
    return this.slugs[this.state];
  }
}
