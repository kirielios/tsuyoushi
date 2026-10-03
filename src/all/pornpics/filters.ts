// Port of keiyoushi/extensions-source src/all/pornpics/Filters.kt (+ Dto.kt, JsonFileLoader.kt)
// The upstream JSON assets are imported as modules. Only English data is bundled: meta.json builds only the "en" source.
import { Filter, type FilterList } from "../../../sdk/index.ts";
import type { Intl } from "../../../libs/i18n/index.ts";
import categories from "./data/categories_en.json" with { type: "json" };
import channels from "./data/channels_en.json" with { type: "json" };
import pornStars from "./data/porn_stars_en.json" with { type: "json" };
import recommendCategories from "./data/recommend_categories_en.json" with { type: "json" };
import tags from "./data/tags_en.json" with { type: "json" };

// --- Dto.kt
interface RecommendCategoryDto {
  name: string;
  categoryTypeName: string;
  link: string;
}
interface CategoryDto {
  name: string;
  link: string;
}

/** Kotlin's sortedBy { it.name }: UTF-16 code unit order. */
const byName = <T extends { name: string }>(a: T, b: T) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export interface SortOption {
  name: string;
  urlPart?: string | null;
}

export class SortSelector extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly vals: SortOption[],
  ) {
    super(
      name,
      vals.map((it) => it.name),
    );
  }
  toUriPart() {
    return this.vals[this.state].urlPart ?? null;
  }
}

export enum CategoryType {
  RECOMMEND,
  CATEGORY,
  TAG,
  PORN_STAR,
  CHANNEL,
}
const categoryTypeOf = (name: string): CategoryType => {
  const t = CategoryType[name.toUpperCase() as keyof typeof CategoryType];
  if (t === undefined) throw new Error("NullPointerException");
  return t;
};

export class CategoryOption {
  constructor(
    readonly name: string,
    readonly type: CategoryType,
    readonly urlPart: string,
  ) {}
  toString() {
    return this.name;
  }
  toUrlPart() {
    return this.urlPart;
  }
  useSearch() {
    return this.urlPart.includes("/search/srch.php?");
  }
}

export interface ActiveCategoryOption {
  name: string;
  categoryType: CategoryType | null;
}

export class CategorySelector extends Filter.Select<string> {
  constructor(
    name: string,
    readonly options: CategoryOption[],
  ) {
    super(
      name,
      options.map((it) => it.name),
    );
  }
  selected() {
    return this.options[this.state];
  }
}

export class ActiveCategoryTypeSelector extends Filter.Select<string> {
  constructor(
    name: string,
    private readonly options: ActiveCategoryOption[],
  ) {
    super(
      name,
      options.map((it) => it.name),
    );
  }
  selected() {
    return this.options[this.state].categoryType!;
  }
  selectedCategoryOption(filters: FilterList): CategoryOption {
    const selectors = filters.filter((f): f is CategorySelector => f instanceof CategorySelector);
    return selectors[this.selected()].selected();
  }
}

export const createSortSelector = (intl: Intl) =>
  new SortSelector(intl.get("filter.time.title"), [{ name: intl.get("filter.time.option.popular") }, { name: intl.get("filter.time.option.recent"), urlPart: "recent?date=latest" }]);

export const createActiveCategoryTypeSelector = (intl: Intl) =>
  new ActiveCategoryTypeSelector(intl.get("filter.active-category-type.title"), [
    { name: intl.get("filter.active-category-type.option.recommend"), categoryType: CategoryType.RECOMMEND },
    { name: intl.get("filter.active-category-type.option.categories"), categoryType: CategoryType.CATEGORY },
    { name: intl.get("filter.active-category-type.option.tags"), categoryType: CategoryType.TAG },
    { name: intl.get("filter.active-category-type.option.porn-star"), categoryType: CategoryType.PORN_STAR },
    { name: intl.get("filter.active-category-type.option.channels"), categoryType: CategoryType.CHANNEL },
  ]);

export const createRecommendSelector = (intl: Intl) =>
  new CategorySelector(
    intl.get("filter.category-type.recommend.title"),
    (recommendCategories as RecommendCategoryDto[]).map((it) => new CategoryOption(it.name, categoryTypeOf(it.categoryTypeName), it.link)).sort(byName),
  );

const simpleSelector = (title: string, data: CategoryDto[], type: CategoryType) => new CategorySelector(title, data.map((it) => new CategoryOption(it.name, type, it.link)).sort(byName));

export const createCategorySelector = (intl: Intl) => simpleSelector(intl.get("filter.category-type.categories.title"), categories as CategoryDto[], CategoryType.CATEGORY);
export const createTagSelector = (intl: Intl) => simpleSelector(intl.get("filter.category-type.tags.title"), tags as CategoryDto[], CategoryType.TAG);
export const createPornStarSelector = (intl: Intl) => simpleSelector(intl.get("filter.category-type.porn-star.title"), pornStars as CategoryDto[], CategoryType.PORN_STAR);
export const createChannelSelector = (intl: Intl) => simpleSelector(intl.get("filter.category-type.channels.title"), channels as CategoryDto[], CategoryType.CHANNEL);
