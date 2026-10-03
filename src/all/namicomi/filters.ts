// Port of keiyoushi/extensions-source src/all/namicomi/Filters.kt
import { Filter, type HttpUrlBuilder } from "../../../sdk/index.ts";
import { ContentRatingDto, StatusDto } from "./dto.ts";

export interface UrlQueryFilter {
  addQueryParameter(url: HttpUrlBuilder, extLang: string): void;
}
export const isUrlQueryFilter = (f: Filter): f is Filter & UrlQueryFilter => typeof (f as unknown as UrlQueryFilter).addQueryParameter === "function";

export class HasAvailableChaptersFilter extends Filter.CheckBox implements UrlQueryFilter {
  constructor() {
    super("Has available chapters");
  }
  addQueryParameter(url: HttpUrlBuilder, extLang: string) {
    if (this.state) {
      url.addQueryParameter("hasAvailableChapters", "true");
      url.addQueryParameter("availableTranslatedLanguages[]", extLang);
    }
  }
}

export class ContentRating extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class ContentRatingList extends Filter.Group<ContentRating> implements UrlQueryFilter {
  constructor() {
    super("Content rating", contentRatings());
  }
  addQueryParameter(url: HttpUrlBuilder, _extLang: string) {
    this.state.filter((it) => it.state).forEach((it) => url.addQueryParameter("contentRatings[]", it.value));
  }
}

const contentRatings = () => [new ContentRating("Safe", ContentRatingDto.SAFE), new ContentRating("Restricted", ContentRatingDto.RESTRICTED), new ContentRating("Mature", ContentRatingDto.MATURE)];

export class Status extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

export class StatusList extends Filter.Group<Status> implements UrlQueryFilter {
  constructor() {
    super("Status", status());
  }
  addQueryParameter(url: HttpUrlBuilder, _extLang: string) {
    this.state.filter((it) => it.state).forEach((it) => url.addQueryParameter("publicationStatuses[]", it.value));
  }
}

const status = () => [new Status("Ongoing", StatusDto.ONGOING), new Status("Completed", StatusDto.COMPLETED), new Status("Hiatus", StatusDto.HIATUS), new Status("Cancelled", StatusDto.CANCELLED)];

interface Sortable {
  title: string;
  value: string;
}

const sortables: Sortable[] = [
  { title: "Alphabetic", value: "title" },
  { title: "Chapter count", value: "chapterCount" },
  { title: "Followers", value: "followCount" },
  { title: "Likes", value: "reactions" },
  { title: "Comment count", value: "commentCount" },
  { title: "Content created at", value: "publishedAt" },
  { title: "Views", value: "views" },
  { title: "Year", value: "year" },
  { title: "Rating", value: "rating" },
];

export class SortFilter extends Filter.Sort implements UrlQueryFilter {
  constructor() {
    super(
      "Sort",
      sortables.map((it) => it.title),
      { index: 5, ascending: false },
    );
  }
  addQueryParameter(url: HttpUrlBuilder, _extLang: string) {
    if (this.state != null) {
      const query = sortables[this.state.index].value;
      const value = this.state.ascending ? "asc" : "desc";
      url.addQueryParameter(`order[${query}]`, value);
    }
  }
}

export class Tag extends Filter.TriState {
  constructor(
    readonly id: string,
    name: string,
  ) {
    super(name);
  }
}

export class TagList extends Filter.Group<Tag> implements UrlQueryFilter {
  constructor(collection: string, tags: Tag[]) {
    super(collection, tags);
  }
  addQueryParameter(url: HttpUrlBuilder, _extLang: string) {
    this.state.forEach((tag) => {
      if (tag.isIncluded()) url.addQueryParameter("includedTags[]", tag.id);
      else if (tag.isExcluded()) url.addQueryParameter("excludedTags[]", tag.id);
    });
  }
}

interface TagMode {
  title: string;
  value: string;
}

const tagModes: TagMode[] = [
  { title: "And", value: "and" },
  { title: "Or", value: "or" },
];

/** Filter.Select<TagMode>: the app shows the titles (TagMode.toString()), the values stay here. */
class TagInclusionMode extends Filter.Select<string> implements UrlQueryFilter {
  constructor() {
    super(
      "Included tags mode",
      tagModes.map((it) => it.title),
      0,
    );
  }
  addQueryParameter(url: HttpUrlBuilder, _extLang: string) {
    url.addQueryParameter("includedTagsMode", tagModes[this.state].value);
  }
}

class TagExclusionMode extends Filter.Select<string> implements UrlQueryFilter {
  constructor() {
    super(
      "Excluded tags mode",
      tagModes.map((it) => it.title),
      1,
    );
  }
  addQueryParameter(url: HttpUrlBuilder, _extLang: string) {
    url.addQueryParameter("excludedTagsMode", tagModes[this.state].value);
  }
}

export class TagsFilterMode extends Filter.Group<Filter> implements UrlQueryFilter {
  constructor() {
    super("Tags mode", [new TagInclusionMode(), new TagExclusionMode()]);
  }
  addQueryParameter(url: HttpUrlBuilder, extLang: string) {
    this.state.filter(isUrlQueryFilter).forEach((filter) => filter.addQueryParameter(url, extLang));
  }
}
