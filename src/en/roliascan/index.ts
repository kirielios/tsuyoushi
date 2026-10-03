// Port of keiyoushi/extensions-source src/en/roliascan/RoliaScan.kt
import { Filter, FilterList, MangasPage, type Page, type SChapter, type SManga } from "../../../sdk/index.ts";
import { MangaTaro, SearchWithFilters, SortFilter, StatusFilter, TagFilter, TagFilterMatch, TypeFilter, YearFilter, type BrowseManga } from "../../../themes/mangataro/index.ts";

const API_PAGES_PER_PAGE = 5;

export default class RoliaScan extends MangaTaro {
  // ========================== Search =========================
  override getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    return this.fetchMultiplePages(page, (it) => this.fetchBrowsePage(it, query, filters));
  }

  // ========================== Latest =========================
  // RoliaScan's API returns chapter-level entries with
  // blank URLs mixed in with actual manga entries.
  // Aggregate results from multiple API pages so
  // the user always gets a full page of results.
  override getLatestUpdates(page: number): Promise<MangasPage> {
    return this.fetchMultiplePages(page, (it) => this.fetchBrowsePage(it, "", SortFilter.latest));
  }

  // ========================== Pages ==========================
  override getPageList(chapter: SChapter): Promise<Page[]> {
    if (chapter.url.endsWith("/")) throw new Error("Refresh Manga to update information about chapters");
    return super.getPageList(chapter);
  }

  // ========================= Filters =========================
  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(
      new SearchWithFilters(),
      new Filter.Header("If unchecked, all filters will be ignored with search query"),
      new Filter.Header("But will give more relevant results"),
      new Filter.Separator(),
      new SortFilter(),
      new TypeFilter(),
      new StatusFilter(),
      new YearFilter(),
      new TagFilter(roliaTags),
      new TagFilterMatch(),
    );
  }

  // ========================= Helpers =========================
  private async fetchMultiplePages(page: number, fetchPage: (apiPage: number) => Promise<BrowseManga[]>): Promise<MangasPage> {
    const startApiPage = (page - 1) * API_PAGES_PER_PAGE + 1;
    const endApiPage = startApiPage + API_PAGES_PER_PAGE - 1;

    const allMangas: SManga[] = [];
    const seenIds = new Set<string>();
    let lastRawSize = 0;

    for (let apiPage = startApiPage; apiPage <= endApiPage; apiPage++) {
      const data = await fetchPage(apiPage);
      lastRawSize = data.length;

      for (const it of data.filter((it) => it.type !== "Novel" && it.url.trim() !== "")) {
        if (!seenIds.has(it.id)) {
          seenIds.add(it.id);
          allMangas.push(this.browseMangaToSManga(it));
        }
      }

      if (data.length < 24) break;
    }

    return new MangasPage(allMangas, lastRawSize === 24);
  }
}

const roliaTags: [string, number][] = [
  ["Action", 5],
  ["Adaptation", 49],
  ["Adapted to Manhua", 717],
  ["Adult Cast", 119],
  ["Adventure", 19],
  ["Aliens", 803],
  ["Animals", 240],
  ["Award Winning", 8],
  ["Childcare", 1146],
  ["Combat Sports", 358],
  ["Comedy", 61],
  ["Cooking", 266],
  ["Crime", 248],
  ["Crossdressing", 724],
  ["Delinquents", 228],
  ["Demons", 162],
  ["Detective", 150],
  ["Drama", 26],
  ["Ecchi", 117],
  ["Erotica", 202],
  ["Fantasy", 17],
  ["Full Color", 40],
  ["Gag Humor", 1068],
  ["Game", 1130],
  ["Gender Bender", 1190],
  ["Ghosts", 215],
  ["Gore", 187],
  ["Gourmet", 89],
  ["Harem", 47],
  ["Historical", 66],
  ["Horror", 67],
  ["Isekai", 55],
  ["Josei", 1062],
  ["Light Novel", 98],
  ["Long Strip", 41],
  ["Love Status Quo", 541],
  ["Mafia", 356],
  ["Magic", 45],
  ["Magical Sex Shift", 551],
  ["Manga", 97],
  ["Manhua", 35],
  ["Manhwa", 18],
  ["Martial Arts", 56],
  ["Mature", 404],
  ["Mecha", 396],
  ["Medical", 244],
  ["Military", 131],
  ["Monster Girls", 231],
  ["Monsters", 46],
  ["Music", 694],
  ["Mystery", 34],
  ["Mythology", 110],
  ["Ninja", 163],
  ["Office Workers", 505],
  ["Official Colored", 866],
  ["Organized Crime", 134],
  ["Otaku Culture", 570],
  ["Parody", 605],
  ["Philosophical", 912],
  ["Post-Apocalyptic", 241],
  ["Psychological", 149],
  ["Regression", 1131],
  ["Reincarnation", 29],
  ["Revenge", 964],
  ["Reverse Harem", 1085],
  ["Romance", 2],
  ["Romantic Subtext", 486],
  ["School", 14],
  ["School Life", 27],
  ["Sci-Fi", 33],
  ["Seinen", 105],
  ["Self-Published", 577],
  ["Sexual Violence", 536],
  ["Shoujo", 1071],
  ["Shounen", 11],
  ["Showbiz", 429],
  ["Slice of Life", 93],
  ["Smut", 742],
  ["Space", 206],
  ["Sports", 9],
  ["Streaming", 1132],
  ["Suggestive", 1116],
  ["Super Power", 6],
  ["Superhero", 865],
  ["Supernatural", 65],
  ["Survival", 236],
  ["Suspense", 287],
  ["Team Sports", 10],
  ["Thriller", 184],
  ["Time Travel", 37],
  ["Tragedy", 316],
  ["Transmigiration", 1133],
  ["Urban Fantasy", 120],
  ["Vampire", 209],
  ["Video Game", 277],
  ["Video Games", 616],
  ["Villainess", 355],
  ["Virtual Reality", 617],
  ["Web Comic", 48],
  ["Webtoon", 350],
  ["Workplace", 138],
  ["Wuxia", 68],
  ["Xianxia", 718],
  ["Zombies", 1115],
];
