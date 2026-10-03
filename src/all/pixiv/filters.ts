// Port of keiyoushi/extensions-source src/all/pixiv/PixivFilters.kt
import { Filter } from "../../../sdk/index.ts";
import type { PixivIllust } from "./types.ts";

const TYPE_VALUES = ["All", "Illustrations", "Manga"];
const TYPE_PARAMS = [null, "illust", "manga"];

const TAGS_MODE_VALUES = ["Partial", "Full"];
const TAGS_MODE_PARAMS = ["s_tag", "s_tag_full"];

const RATING_VALUES = ["All", "All ages", "R-18"];
const RATING_PARAMS = [null, "all", "r18"];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Upstream is a MutableList<Filter<*>> that the source casts `filters.list` back to. Here it wraps a filter list in a
 * fixed order (the host may hand back rehydrated filters), so accessors go by position.
 */
export class PixivFilters {
  readonly list: Filter[];

  constructor(list?: Filter[]) {
    this.list =
      list ??
      [
        new Filter.Header("Deeplinks supported in search: pixiv link, aid:123, user:123, sid:123"),
        new Filter.Select<string>("Type", TYPE_VALUES, 2),
        new Filter.Text("Tags"),
        new Filter.Select<string>("Tags mode", TAGS_MODE_VALUES, 0),
        new Filter.Text("Users"),
        new Filter.Header("The usersFilter filter acts as lookup when search query is blank (requires login via WebView)"),
        new Filter.Select<string>("Rating", RATING_VALUES, 0),
        new Filter.Header("(the following are ignored when the users filter is in use)"),
        new Filter.Sort("Order", ["Date posted"]),
        new Filter.Text("Posted before"),
        new Filter.Text("Posted after"),
      ];
  }

  private get typeFilter() {
    return this.list[1] as Filter.Select;
  }
  private get tagsFilter() {
    return this.list[2] as Filter.Text;
  }
  private get tagsModeFilter() {
    return this.list[3] as Filter.Select;
  }
  private get usersFilter() {
    return this.list[4] as Filter.Text;
  }
  private get ratingFilter() {
    return this.list[6] as Filter.Select;
  }
  private get orderFilter() {
    return this.list[8] as Filter.Sort;
  }
  private get dateBeforeFilter() {
    return this.list[9] as Filter.Text;
  }
  private get dateAfterFilter() {
    return this.list[10] as Filter.Text;
  }

  get type(): string | null {
    return TYPE_PARAMS[this.typeFilter.state];
  }

  get tags(): string {
    return this.tagsFilter.state;
  }
  get searchMode(): string {
    return TAGS_MODE_PARAMS[this.tagsModeFilter.state];
  }

  makeTagsPredicate(): ((illust: PixivIllust) => boolean) | null {
    if (!this.tags.trim()) return null;
    const tags = this.tags.split(" ");

    if (this.tagsModeFilter.state === 0) {
      const regex = new RegExp(tags.map(escapeRegex).join("|"));
      return (it) => it.tags?.some((t) => regex.test(t)) === true;
    }
    return (it) => it.tags != null && tags.every((t) => it.tags!.includes(t));
  }

  get users(): string {
    return this.usersFilter.state;
  }

  makeUsersPredicate(): ((illust: PixivIllust) => boolean) | null {
    if (!this.users.trim()) return null;
    const regex = new RegExp(
      this.users
        .split(" ")
        .map(escapeRegex)
        .join("|"),
      "i",
    );
    return (it) => it.author_details?.user_name != null && regex.test(it.author_details.user_name);
  }

  get rating(): string | null {
    return RATING_PARAMS[this.ratingFilter.state];
  }
  makeRatingPredicate(): ((illust: PixivIllust) => boolean) | null {
    return [null, (it: PixivIllust) => it.x_restrict === "0", (it: PixivIllust) => it.x_restrict === "1"][this.ratingFilter.state];
  }

  get order(): string | null {
    return this.orderFilter.state != null ? "date" : null;
  }

  get dateBefore(): string {
    return this.dateBeforeFilter.state;
  }
  get dateAfter(): string {
    return this.dateAfterFilter.state;
  }

  /** filters.toList(): the values equality/hashCode of the filter states is taken over. */
  stateKey(): string {
    return JSON.stringify(this.list.map((f) => f.state));
  }
}
