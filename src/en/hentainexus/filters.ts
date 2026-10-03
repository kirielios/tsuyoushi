// Port of keiyoushi/extensions-source src/en/hentainexus/Filters.kt
import { Filter, type FilterList } from "../../../sdk/index.ts";

export class AdvSearchEntryFilter extends Filter.Text {
  constructor(
    name: string,
    readonly key: string = name.toLowerCase().replace(/s$/, ""),
  ) {
    super(name);
  }
}

export class OffsetPageFilter extends Filter.Text {
  constructor() {
    super("Offset results by # pages");
  }
}

export class TagFilter extends AdvSearchEntryFilter {
  constructor() {
    super("Tags");
  }
}
export class ArtistFilter extends AdvSearchEntryFilter {
  constructor() {
    super("Artists");
  }
}
export class AuthorFilter extends AdvSearchEntryFilter {
  constructor() {
    super("Authors");
  }
}
export class CircleFilter extends AdvSearchEntryFilter {
  constructor() {
    super("Circles");
  }
}
export class EventFilter extends AdvSearchEntryFilter {
  constructor() {
    super("Events");
  }
}
export class ParodyFilter extends AdvSearchEntryFilter {
  constructor() {
    super("Parodies", "parody");
  }
}
export class MagazineFilter extends AdvSearchEntryFilter {
  constructor() {
    super("Magazines");
  }
}
export class PublisherFilter extends AdvSearchEntryFilter {
  constructor() {
    super("Publishers");
  }
}

interface AdvSearchEntry {
  key: string;
  text: string;
  exclude: boolean;
}

function splitFilterState(state: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const ch of state) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      const token = current.trim();
      if (token.length > 0) tokens.push(token);
      current = "";
    } else {
      current += ch;
    }
  }
  const last = current.trim();
  if (last.length > 0) tokens.push(last);
  return tokens;
}

export function combineQuery(filters: FilterList): string {
  const advSearch: AdvSearchEntry[] = filters
    .filter((it): it is AdvSearchEntryFilter => it instanceof AdvSearchEntryFilter)
    .flatMap((filter) =>
      splitFilterState(filter.state).map((token) => {
        const exclude = token.startsWith("-");
        const text = exclude ? token.slice(1) : token;
        return { key: filter.key, text, exclude };
      }),
    );

  let out = "";
  for (const entry of advSearch) {
    if (entry.exclude) out += "-";
    out += entry.key;
    out += ":";
    out += entry.text;
    out += " ";
  }
  return out;
}
