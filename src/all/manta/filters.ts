// Port of keiyoushi/extensions-source src/all/manta/MantaFilters.kt
import { Filter, type FilterList } from "../../../sdk/index.ts";

export class Category extends Filter.Select<string> {
  readonly selectedValues: [string, string][];
  constructor(lang: string) {
    const values = Category.getValues(lang);
    super(
      lang === "es" ? "Categoría" : "Category",
      values.map((it) => it[0]),
    );
    this.selectedValues = values;
  }

  static getValues(lang: string): [string, string][] {
    return lang === "es"
      ? [
          ["Nueva", "tagId=288"],
          ["Exclusiva", "tagId=289"],
          ["Finalizada", "tagId=287"],
          ["Romantasía", "tagId=355"],
          ["Romance", "tagId=3"],
          ["BL", "tagId=16"],
          ["Comedia", "tagId=13"],
          ["Histórico", "tagId=7"],
          ["Vida cotidiana", "tagId=11"],
        ]
      : [
          ["Unlimited", "tagId=359"],
          ["New", "tagId=288"],
          ["Exclusive", "tagId=289"],
          ["Completed", "tagId=287"],
          ["Event", "tagId=354"],
          ["Romantasy", "tagId=355"],
          ["Romance", "tagId=3"],
          ["Fantasy/Sci-Fi", "tagId=14"],
          ["Drama", "tagId=2"],
          ["Thriller", "tagId=231"],
          ["BL", "tagId=16"],
          ["GL", "tagId=17"],
          ["Nonfiction", "tagId=249"],
          ["Action & Adventure", "tagId=361"],
          ["Comedy", "tagId=13"],
          ["Historical", "tagId=7"],
          ["Horror", "tagId=1"],
          ["School life", "tagId=74"],
          ["Slice of life", "tagId=11"],
          ["Sports", "tagId=6"],
          ["Suspense & Thriller", "tagId=362"],
        ];
  }
}

/** val List<Filter<*>>.category */
export const categoryOf = (filters: FilterList): [string, string] => {
  const it = filters.find((f): f is Category => f instanceof Category);
  return it ? it.selectedValues[it.state] : ["", ""];
};
