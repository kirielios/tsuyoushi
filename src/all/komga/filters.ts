// Port of keiyoushi/extensions-source src/all/komga/KomgaFilters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";
import type { AuthorDto, LibraryDto } from "./dto.ts";

export const TYPE_SERIES = "Series";
export const TYPE_READLISTS = "Read lists";
export const TYPE_BOOKS = "Books";

export interface UriFilter {
  addToUri(builder: HttpUrlBuilder): void;
}
export const isUriFilter = (it: Filter): it is Filter & UriFilter => typeof (it as Partial<UriFilter>).addToUri === "function";

export class TypeSelect extends Filter.Select<string> {
  constructor() {
    super("Search for", [TYPE_SERIES, TYPE_READLISTS, TYPE_BOOKS]);
  }
}

export class SeriesSort extends Filter.Sort {
  constructor(selection: { index: number; ascending: boolean } | null = null) {
    super("Sort", ["Relevance", "Alphabetically", "Date added", "Date updated", "Random"], selection ?? { index: 0, ascending: true });
  }
}

export class UnreadFilter extends Filter.CheckBox implements UriFilter {
  constructor() {
    super("Unread", false);
  }
  addToUri(builder: HttpUrlBuilder) {
    if (!this.state) return;
    builder.addQueryParameter("read_status", "UNREAD");
    builder.addQueryParameter("read_status", "IN_PROGRESS");
  }
}

export class InProgressFilter extends Filter.CheckBox implements UriFilter {
  constructor() {
    super("In Progress", false);
  }
  addToUri(builder: HttpUrlBuilder) {
    if (!this.state) return;
    builder.addQueryParameter("read_status", "IN_PROGRESS");
  }
}

export class ReadFilter extends Filter.CheckBox implements UriFilter {
  constructor() {
    super("Read", false);
  }
  addToUri(builder: HttpUrlBuilder) {
    if (!this.state) return;
    builder.addQueryParameter("read_status", "READ");
  }
}

export class UriMultiSelectOption extends Filter.CheckBox {
  constructor(
    name: string,
    readonly id: string = name,
  ) {
    super(name, false);
  }
}

export class UriMultiSelectFilter extends Filter.Group<UriMultiSelectOption> implements UriFilter {
  constructor(
    name: string,
    private readonly param: string,
    genres: UriMultiSelectOption[],
  ) {
    super(name, genres);
  }
  addToUri(builder: HttpUrlBuilder) {
    const whatToInclude = this.state.filter((it) => it.state).map((it) => it.id);
    if (whatToInclude.length) builder.addQueryParameter(this.param, whatToInclude.join(","));
  }
}

export class LibraryFilter extends UriMultiSelectFilter {
  constructor(libraries: LibraryDto[], defaultLibraries: string[]) {
    super(
      "Libraries",
      "library_id",
      libraries.map((it) => {
        const option = new UriMultiSelectOption(it.name, it.id);
        option.state = defaultLibraries.includes(it.id);
        return option;
      }),
    );
  }
}

export class AuthorFilter extends Filter.CheckBox {
  constructor(readonly author: AuthorDto) {
    super(author.name, false);
  }
}

export class AuthorGroup extends Filter.Group<AuthorFilter> implements UriFilter {
  constructor(role: string, authors: AuthorFilter[]) {
    super(role.charAt(0).toUpperCase() + role.slice(1), authors);
  }
  addToUri(builder: HttpUrlBuilder) {
    for (const it of this.state.filter((a) => a.state).map((a) => a.author)) builder.addQueryParameter("author", `${it.name},${it.role}`);
  }
}

export interface CollectionFilterEntry {
  name: string;
  id?: string | null;
}

export class CollectionSelect extends Filter.Select<string> {
  constructor(readonly collections: CollectionFilterEntry[]) {
    super(
      "Collection",
      collections.map((it) => it.name),
    );
  }
}
