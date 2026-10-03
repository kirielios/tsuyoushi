// Port of keiyoushi/extensions-source src/en/eggporncomics/Eggporncomics.kt (+ Filters.kt)
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, firstInstanceOrNull, isBlank, substringBefore, toHttpUrl, urlWithoutDomain, type Document, type Element } from "../../../sdk/index.ts";

// --- Filters.kt
class UriPartFilter extends Filter.Select<string> {
  constructor(
    displayName: string,
    private readonly vals: [string, string | null][],
  ) {
    super(
      displayName,
      vals.map((it) => it[0]),
    );
  }
  toUriPart() {
    return this.vals[this.state][1];
  }
  isNotNull(): boolean {
    return this.toUriPart() != null;
  }
}

class CategoryFilter extends UriPartFilter {}
class ComicsFilter extends UriPartFilter {}

const getCategoryList: [string, string | null][] = [
  ["Any", null],
  ["3d comics", "7/3d-comics"],
  ["Anime Comics", "1/anime-comics"],
  ["Cartoon", "2/cartoon"],
  ["Dickgirls & Shemale", "6/dickgirls-shemale"],
  ["Doujinshi", "19/doujinshi"],
  ["Furry", "4/furry"],
  ["Games comics", "3/games-comics"],
  ["Hentai manga", "10/hentai-manga"],
  ["Interracial", "14/interracial"],
  ["Milf", "11/milf"],
  ["Mindcontrol", "15/mindcontrol"],
  ["Western", "12/western"],
  ["Yaoi and Gay", "8/yaoi-and-gay"],
  ["Yuri and Lesbian", "9/yuri-and-lesbian"],
];

const getComicsList: [string, string | null][] = [
  ["Any", null],
  ["3d", "85/3d"],
  ["Adventure Time", "2950/adventure-time"],
  ["Anal", "13/anal"],
  ["Ben 10", "641/ben10"],
  ["Big boobs", "3025/big-boobs"],
  ["Big breasts", "6/big-breasts"],
  ["Big cock", "312/big-cock"],
  ["Bigass", "604/big-ass-porn-comics-new"],
  ["Black cock", "2990/black-cock"],
  ["Blowjob", "7/blowjob"],
  ["Bondage", "24/bondage"],
  ["Breast expansion hentai", "102/breast-expansion-new"],
  ["Cumshot", "427/cumshot"],
  ["Dark skin", "29/dark-skin"],
  ["Dofantasy", "1096/dofantasy"],
  ["Double penetration", "87/double-penetration"],
  ["Doujin moe", "3028/doujin-moe"],
  ["Erotic", "602/erotic"],
  ["Fairy tail porn", "3036/fairy-tail"],
  ["Fakku", "1712/Fakku-Comics-new"],
  ["Fakku comics", "1712/fakku-comics-new"],
  ["Family Guy porn", "774/family-guy"],
  ["Fansadox", "1129/fansadox-collection"],
  ["Feminization", "385/feminization"],
  ["Forced", "315/forced"],
  ["Full color", "349/full-color"],
  ["Furry", "19/furry"],
  ["Futanari", "2994/futanari"],
  ["Group", "58/group"],
  ["Hardcore", "304/hardcore"],
  ["Harry Potter porn", "338/harry-potter"],
  ["Hentai", "321/hentai"],
  ["Incest", "3007/incest"],
  ["Incest - Family Therapy Top", "3007/family-therapy-top"],
  ["Incognitymous", "545/incognitymous"],
  ["Interracical", "608/interracical"],
  ["Jab Comix", "1695/JAB-Comics-NEW-2"],
  ["Kaos comics", "467/kaos"],
  ["Kim Possible porn", "788/kim-possible"],
  ["Lesbian", "313/lesbian"],
  ["Locofuria", "343/locofuria"],
  ["Milf", "48/milf"],
  ["Milftoon", "1678/milftoon-comics"],
  ["Muscle", "2/muscle"],
  ["Nakadashi", "10/nakadashi"],
  ["PalComix", "373/palcomix"],
  ["Pokemon hentai", "657/pokemon"],
  ["Shadbase", "1717/shadbase-comics"],
  ["Shemale", "126/shemale"],
  ["Slut", "301/slut"],
  ["Sparrow hentai", "3035/sparrow-hentai"],
  ["Star Wars hentai", "1344/star-wars"],
  ["Stockings", "51/stockings"],
  ["Superheroine Central", "615/superheroine-central"],
  ["The Cummoner", "3034/the-cummoner"],
  ["The Rock Cocks", "3031/the-rock-cocks"],
  ["ZZZ Comics", "1718/zzz-comics"],
];

const queryRegex = /[\s']/g;
const descriptionPrefixRegex = /:.*/;

export default class Eggporncomics extends KeiSource {
  // Popular

  // couldn't find a page with popular comics, defaulting to the popular "anime-comics" category
  async getPopularManga(page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/category/1/anime-comics?page=${page}`)).asJsoup());
  }

  private parseMangaList(document: Document): MangasPage {
    const mangas = document.select("div.preview:has(div.name)").map((element) => {
      const manga = SManga.create();
      const a = element.selectFirst("a:has(img)");
      if (a) {
        manga.url = urlWithoutDomain(a.absUrl("href"));
        manga.title = a.text();
        manga.thumbnail_url = a.selectFirst("img")?.absUrl("src");
      }
      return manga;
    });
    const hasNextPage = document.selectFirst("ul.ne-pe li.next:not(.disabled)") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  // Latest

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.parseMangaList((await this.client.get(`${this.baseUrl}/latest-comics?page=${page}`)).asJsoup());
  }

  // Search

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    let url: string;
    if (!isBlank(query)) {
      url = toHttpUrl(`${this.baseUrl}/search/${query.replace(queryRegex, "-")}?page=${page}`).toString();
    } else {
      const builder = toHttpUrl(this.baseUrl).newBuilder();
      const category = firstInstanceOrNull(filters, CategoryFilter);
      const comics = firstInstanceOrNull(filters, ComicsFilter);

      if (category?.isNotNull() === true && comics?.isNotNull() === true) {
        builder.addPathSegments(`category-tag/${category.toUriPart()}/${comics.toUriPart()}`);
      } else if (category?.isNotNull() === true) {
        builder.addPathSegments(`category/${category.toUriPart()}`);
      } else if (comics?.isNotNull() === true) {
        builder.addPathSegments(`comics-tag/${comics.toUriPart()}`);
      }

      builder.addQueryParameter("page", String(page));
      url = builder.build().toString();
    }

    const response = await this.client.get(url, undefined, { ensureSuccess: false });
    if (!response.isSuccessful) {
      // when combining a category filter and comics filter, if there are no results the source
      // issues a 404, override that so as not to confuse users
      if (response.url.includes("category-tag") && response.code === 404) return new MangasPage([], false);
      throw new Error(`HTTP error ${response.code}`);
    }

    return this.parseMangaList(response.asJsoup());
  }

  // Details & Chapters

  async fetchMangaUpdate(manga: SManga, _chapters: SChapter[], _fetchDetails: boolean, _fetchChapters: boolean): Promise<SMangaUpdate> {
    const response = await this.client.get(this.getMangaUrl(manga));
    const chapterUrl = response.url;
    const document = response.asJsoup();

    const img = document.selectFirst("div.grid div.image img");
    manga.thumbnail_url = img ? this.toFullSizeImage(img) : undefined;
    manga.description = document
      .select("div.links ul")
      .map((element) =>
        element.select("span").text().replace(descriptionPrefixRegex, ": ") +
        element
          .select("a")
          .map((it) => it.text())
          .join(", "),
      )
      .join("\n");

    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(chapterUrl);
    chapter.name = "Chapter";
    const daysAgo = document.selectFirst("div.info > div.meta li:contains(days ago)");
    if (daysAgo) {
      const n = Number.parseInt(substringBefore(daysAgo.text(), " "), 10);
      const d = new Date();
      d.setDate(d.getDate() - (Number.isNaN(n) ? 0 : n));
      chapter.date_upload = d.getTime();
    }

    return new SMangaUpdate(manga, [chapter]);
  }

  // Pages

  private toFullSizeImage(e: Element) {
    return e.absUrl("src").replace("thumb300_", "");
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.getChapterUrl(chapter))).asJsoup();
    return document.select("div.grid div.image img").map((img, i) => new Page(i, "", this.toFullSizeImage(img)));
  }

  // Filters

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new Filter.Header("Leave query blank to use filters"), new Filter.Separator(), new CategoryFilter("Category", getCategoryList), new ComicsFilter("Comics", getComicsList));
  }
}
