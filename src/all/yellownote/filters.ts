// Port of keiyoushi/extensions-source src/all/yellownote/Filters.kt
import { Filter } from "../../../sdk/index.ts";
import type { Intl } from "../../../libs/i18n/index.ts";

export class SortOption {
  constructor(readonly name: string, readonly urlPart = "") {}
  toString() {
    return this.name;
  }
}

export class SortSelector extends Filter.Select<SortOption> {
  constructor(name: string, private readonly vals: SortOption[]) {
    super(name, vals);
  }
  toUriPart() {
    return this.vals[this.state].urlPart;
  }
}

export class CategoryOption {
  constructor(readonly name: string, readonly uriPart: string) {}
  toString() {
    return this.name;
  }
}

export class CategorySelector extends Filter.Select<CategoryOption> {
  toUriPart() {
    return this.values[this.state].uriPart;
  }
}

export const Filters = {
  createSortSelector: (intl: Intl): SortSelector =>
    new SortSelector(intl.get("filter.sort.title"), [
      new SortOption(intl.get("filter.sort.option.last-update")),
      new SortOption(intl.get("filter.sort.option.popularity"), "sort-hot"),
      new SortOption(intl.get("filter.sort.option.most-comments"), "sort-comment"),
      new SortOption(intl.get("filter.sort.option.latest-comments"), "sort-recent"),
    ]),

  themeCategoryOptions: (intl: Intl): CategoryOption[] => [
    new CategoryOption(intl.get("filter.category.option.theme.xiuren-featured"), "photos/album-1"),
    new CategoryOption(intl.get("filter.category.option.theme.large-scale"), "photos/album-2"),
    new CategoryOption(intl.get("filter.category.option.theme.sex"), "photos/album-3"),
    new CategoryOption(intl.get("filter.category.option.theme.exposure"), "photos/album-4"),
    new CategoryOption(intl.get("filter.category.option.theme.cosplay"), "photos/album-5"),
    new CategoryOption(intl.get("filter.category.option.theme.sex-toy"), "photos/album-6"),
    new CategoryOption(intl.get("filter.category.option.theme.bondage"), "photos/album-7"),
    new CategoryOption(intl.get("filter.category.option.theme.shaved-pussy"), "photos/album-8"),
    new CategoryOption(intl.get("filter.category.option.theme.lesbian"), "photos/album-9"),
    new CategoryOption(intl.get("filter.category.option.theme.with-original-photos"), "photos/album-10"),
    new CategoryOption(intl.get("filter.category.option.theme.with-video"), "photos/album-11"),
    new CategoryOption(intl.get("filter.category.option.theme.amateur"), "amateurs"),
  ],

  chinaStudiosCategoryOptions: (intl: Intl): CategoryOption[] => [
    new CategoryOption(intl.get("filter.category.option.chinese-studios-pans"), "photos/series-6310ce9b90056"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-wind-sings"), "photos/series-6666a7ac3ba9c"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-xing-se"), "photos/series-64f44d99ce673"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-huang-fu"), "photos/series-665f8bafab4bc"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-other-studios"), "photos/series-665f7d787d681"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-metcn"), "photos/series-5f1dcdeaee582"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-litu"), "photos/series-5f1d784995865"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-midnight-project"), "photos/series-638e5a60b1770"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-pandora"), "photos/series-5f23c44cd66bd"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-missleg"), "photos/series-5f2089564c6c2"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-iss"), "photos/series-646c69b675f3d"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-aiss"), "photos/series-5f15f389e993e"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-au"), "photos/series-5f60b98248a81"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-beijing-angel"), "photos/series-622c7f95220a4"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-wuji-works"), "photos/series-619a92aa1fa7a"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-pomelo"), "photos/series-676c3e9b90749"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-sk-silk"), "photos/series-5f382ba894af4"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-ddy"), "photos/series-5f15f727df393"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-dongguan-vgirls"), "photos/series-5f22ea422221c"),
    new CategoryOption(intl.get("filter.category.option.chinese-studios-youmei"), "photos/series-61b997728043b"),
  ],

  otherPhotosCategoryOptions: (intl: Intl): CategoryOption[] => [
    new CategoryOption(intl.get("filter.category.option.other-photos-chinese-nude"), "photos/series-64be21c972ca4"),
    new CategoryOption(intl.get("filter.category.option.other-photos-korean-nude"), "photos/series-64be22b4a0fa0"),
    new CategoryOption(intl.get("filter.category.option.other-photos-taiwan-nude"), "photos/series-64be21ef4cc51"),
    new CategoryOption(intl.get("filter.category.option.other-photos-other-regions"), "photos/series-64be239ce73d4"),
  ],

  xiuRenCategoryOptions: (intl: Intl): CategoryOption[] => [
    new CategoryOption(intl.get("filter.category.option.xiuren-all"), "photos/series-6660093348354"),
    new CategoryOption(intl.get("filter.category.option.xiuren-leaked"), "photos/series-66600a3a227ee"),
    new CategoryOption(intl.get("filter.category.option.xiuren-huayang"), "photos/series-5fc4ce40386af"),
    new CategoryOption(intl.get("filter.category.option.xiuren-mygirl"), "photos/series-5f1495dbda4de"),
    new CategoryOption(intl.get("filter.category.option.xiuren-imiss"), "photos/series-5f71afc92d8ab"),
    new CategoryOption(intl.get("filter.category.option.xiuren-miitao"), "photos/series-5f1dd5a7ebe9a"),
    new CategoryOption(intl.get("filter.category.option.xiuren-feilin"), "photos/series-5f14a3105d3e8"),
    new CategoryOption(intl.get("filter.category.option.xiuren-youwu"), "photos/series-60673bec9dd11"),
    new CategoryOption(intl.get("filter.category.option.xiuren-wings"), "photos/series-63d435352808c"),
    new CategoryOption(intl.get("filter.category.option.xiuren-ruisg"), "photos/series-61263de287e2f"),
  ],

  koreanStudiosCategoryOptions: (intl: Intl): CategoryOption[] => [
    new CategoryOption(intl.get("filter.category.option.korean-studios-makemodel"), "photos/series-665f81885f103"),
    new CategoryOption(intl.get("filter.category.option.korean-studios-pure-media"), "photos/series-6224e755e21f4"),
    new CategoryOption(intl.get("filter.category.option.korean-studios-espacia-korea"), "photos/series-665a2385a2367"),
    new CategoryOption(intl.get("filter.category.option.korean-studios-loozy"), "photos/series-62888afad416b"),
  ],

  japaneseStudiosCategoryOptions: (intl: Intl): CategoryOption[] => [
    new CategoryOption(intl.get("filter.category.option.japanese-studios-graphis"), "photos/series-6450b47c9db0b"),
    new CategoryOption(intl.get("filter.category.option.japanese-studios-kuni-scan"), "photos/series-66f9665804471"),
    new CategoryOption(intl.get("filter.category.option.japanese-studios-weekly-post-digital-photo"), "photos/series-66e68b9c96ab0"),
    new CategoryOption(intl.get("filter.category.option.japanese-studios-morning-sexy"), "photos/series-670d7142b3d88"),
    new CategoryOption(intl.get("filter.category.option.japanese-studios-prestige"), "photos/series-670791f5f2f0f"),
    new CategoryOption(intl.get("filter.category.option.japanese-studios-x-city"), "photos/series-66fb8cca706ae"),
    new CategoryOption(intl.get("filter.category.option.japanese-studios-friday"), "photos/series-66659e2d94489"),
    new CategoryOption(intl.get("filter.category.option.japanese-studios-super-pose-book"), "photos/series-62a0a15911f16"),
    new CategoryOption(intl.get("filter.category.option.japanese-studios-urabon"), "photos/series-6692ea004cc75"),
    new CategoryOption(intl.get("filter.category.option.japanese-studios-escape"), "photos/series-66603af933ec9"),
    new CategoryOption(intl.get("filter.category.option.japanese-studios-flash"), "photos/series-672a2029d6a32"),
  ],

  taiwanStudiosCategoryOptions: (intl: Intl): CategoryOption[] => [
    new CategoryOption(intl.get("filter.category.option.taiwan-studios-jvid"), "photos/series-637b2029d2347"),
    new CategoryOption(intl.get("filter.category.option.taiwan-studios-fantasy-factory"), "photos/series-5f889afb37619"),
    new CategoryOption(intl.get("filter.category.option.taiwan-studios-tpimage"), "photos/series-5f7a0a80d3d66"),
  ],

  otherCategoryOptions: (intl: Intl): CategoryOption[] => [
    new CategoryOption(intl.get("filter.category.option.others-ai-photos"), "photos/series-6443d480eb757"),
  ],

  createCategorySelector: (intl: Intl): CategorySelector =>
    new CategorySelector(intl.get("filter.category.title"), [
      ...Filters.themeCategoryOptions(intl),
      ...Filters.taiwanStudiosCategoryOptions(intl),
      ...Filters.chinaStudiosCategoryOptions(intl),
      ...Filters.otherCategoryOptions(intl),
      ...Filters.koreanStudiosCategoryOptions(intl),
      ...Filters.japaneseStudiosCategoryOptions(intl),
      ...Filters.otherPhotosCategoryOptions(intl),
      ...Filters.xiuRenCategoryOptions(intl),
    ]),
};
