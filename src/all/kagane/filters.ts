// Port of keiyoushi/extensions-source src/all/kagane/Filters.kt
import { Filter } from "../../../sdk/index.ts";
import type { SourceDto } from "./dto.ts";

export const CONTENT_RATINGS = ["safe", "suggestive", "erotica", "pornographic"];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface MetadataDto {
  genres: Record<string, string>;
  tags: Record<string, string>;
  sources: SourceDto[];
}
const byName = (a: FilterData, b: FilterData) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
export const getGenresList = (meta: MetadataDto) => Object.entries(meta.genres).map(([k, v]) => new FilterData(k, v)).sort(byName);
export const getSourcesList = (meta: MetadataDto) => meta.sources.map((it) => new FilterData(it.source_id, it.title)).sort(byName);

type Json = Record<string, unknown>;

/** JsonFilter: `key` is "" unless the caller nests the values under an object. */
export interface JsonFilter {
  addToJsonObject(builder: Json, key?: string, matchAll?: boolean | null): void;
}
export const isJsonFilter = (f: unknown): f is JsonFilter => typeof (f as JsonFilter)?.addToJsonObject === "function";

class SelectFilterOption {
  constructor(
    readonly name: string,
    readonly value: string,
  ) {}
}

const getSortFilter = () => [
  new SelectFilterOption("Relevance", ""),
  new SelectFilterOption("Popular (Total Views)", "total_views"),
  new SelectFilterOption("Popular (Average Views)", "avg_views"),
  new SelectFilterOption("Popular (Today)", "avg_views_today"),
  new SelectFilterOption("Popular (Week)", "avg_views_week"),
  new SelectFilterOption("Popular (Month)", "avg_views_month"),
  new SelectFilterOption("Latest", "updated_at"),
  new SelectFilterOption("By Name", "series_name"),
  new SelectFilterOption("Books count", "books_count"),
  new SelectFilterOption("Created at", "created_at"),
];

export class SortFilter extends Filter.Sort {
  constructor(
    selection: { index: number; ascending: boolean } = { index: 0, ascending: false },
    private readonly options: SelectFilterOption[] = getSortFilter(),
  ) {
    super(
      "Sort By",
      options.map((it) => it.name),
      selection,
    );
  }

  get selected(): SelectFilterOption {
    return (this.state != null ? this.options[this.state.index] : undefined) ?? this.options[0];
  }

  toUriPart(): string {
    const base = this.selected.value;
    const order = this.state?.ascending === true ? "" : ",desc";
    return base ? base + order : "";
  }
}

export class FilterData {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
}

export class MultiSelectOption extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string = name,
  ) {
    super(name, false);
  }
}

export class JsonMultiSelectFilter extends Filter.Group<MultiSelectOption> implements JsonFilter {
  constructor(
    name: string,
    private readonly param: string,
    genres: MultiSelectOption[],
  ) {
    super(name, genres);
  }

  addToJsonObject(builder: Json, key = "", _matchAll: boolean | null = null): void {
    const whatToInclude = this.state.filter((it) => it.state).map((it) => it.id);
    if (whatToInclude.length) {
      if (!key) builder[this.param] = whatToInclude;
      else builder[key] = { [this.param]: whatToInclude };
    }
  }
}

export class MultiSelectTriOption extends Filter.TriState {
  constructor(
    name: string,
    readonly id: string = name,
  ) {
    super(name);
  }
}

export class JsonMultiSelectTriFilter extends Filter.Group<MultiSelectTriOption> implements JsonFilter {
  constructor(
    name: string,
    private readonly param: string,
    genres: MultiSelectTriOption[],
    private readonly extraExcluded: Set<string> = new Set(),
  ) {
    super(name, genres);
  }

  addToJsonObject(builder: Json, key = "", matchAll: boolean | null = null): void {
    const whatToInclude = this.state.filter((it) => it.state === Filter.TriState.STATE_INCLUDE).map((it) => it.id);
    const whatToExclude = [...this.state.filter((it) => it.state === Filter.TriState.STATE_EXCLUDE).map((it) => it.id), ...this.extraExcluded];
    if (whatToInclude.length || whatToExclude.length) {
      const obj: Json = {};
      if (matchAll === true) obj.match_all = true;
      obj.values = whatToInclude;
      if (whatToExclude.length) obj.exclude = whatToExclude;
      builder[key] = obj;
    }
  }
}

export class ContentRatingFilter extends JsonMultiSelectFilter {
  constructor(defaultRatings: Set<string>, ratings: FilterData[] = CONTENT_RATINGS.map((it) => new FilterData(capitalize(it), capitalize(it)))) {
    super(
      "Content Rating",
      "content_rating",
      ratings.map((it) => {
        const o = new MultiSelectOption(it.name, it.id);
        o.state = defaultRatings.has(it.id.toLowerCase());
        return o;
      }),
    );
  }
}

export class GenresFilter extends JsonMultiSelectTriFilter {
  constructor(genres: FilterData[], excludedIds: Set<string> = new Set()) {
    super(
      "Genres",
      "genres",
      genres.map((it) => new MultiSelectTriOption(it.name, it.id)),
      excludedIds,
    );
  }
}

export class TagsSearchFilter extends Filter.Text {
  constructor(readonly tagData: Record<string, string>) {
    super(" Tags (e.g. Medieval, -Politics)");
  }
}

export class SourcesFilter extends JsonMultiSelectFilter {
  constructor(sources: FilterData[]) {
    super(
      "Sources",
      "source_id",
      sources.map((it) => new MultiSelectOption(it.name, it.id)),
    );
  }
}

const FORMAT_OPTIONS = ["Manga", "Manhwa", "Manhua", "Comic", "Other"];

export class FormatFilter extends JsonMultiSelectFilter {
  constructor() {
    super(
      "Format",
      "format",
      FORMAT_OPTIONS.map((it) => new MultiSelectOption(it)),
    );
  }
}

const PUBLICATION_STATUS_OPTIONS: [string, string][] = [
  ["Ongoing", "Ongoing"],
  ["Completed", "Completed"],
  ["Hiatus", "Hiatus"],
  ["Cancelled", "Abandoned"],
];

export class PublicationStatusFilter extends JsonMultiSelectFilter {
  constructor() {
    super(
      "Status",
      "upload_status",
      PUBLICATION_STATUS_OPTIONS.map(([name, value]) => new MultiSelectOption(name, value)),
    );
  }
}

export class MatchAllGenresFilter extends Filter.CheckBox {
  constructor() {
    super("Match all selected genres", true);
  }
}

export class MatchAllTagsFilter extends Filter.CheckBox {
  constructor() {
    super("Match all selected tags", true);
  }
}
