// Port of keiyoushi/extensions-source src/en/theduckwebcomics/TheDuckWebcomics.kt (+ Filters.kt)
import { Filter, FilterList, KeiSource, MangasPage, Page, SChapter, SManga, SMangaUpdate, substringAfter, substringBefore, toHttpUrl, urlWithoutDomain, type Document, type HttpUrlBuilder } from "../../../sdk/index.ts";

// --- Filters.kt
class Label extends Filter.CheckBox {
  constructor(
    name: string,
    readonly value: string,
  ) {
    super(name);
  }
}

interface QueryParam {
  readonly param: string;
  encode(url: HttpUrlBuilder): void;
}

abstract class LabelGroup extends Filter.Group<Label> implements QueryParam {
  abstract readonly param: string;
  encode(url: HttpUrlBuilder): void {
    for (const it of this.state.filter((it) => it.state)) url.addQueryParameter(this.param, it.value);
  }
}

const labels = (...pairs: [string, string][]) => pairs.map(([n, v]) => new Label(n, v));

class TypeFilter extends LabelGroup {
  readonly param = "type";
  constructor() {
    super("Type of comic", labels(["Comic Strip", "0"], ["Comic Book/Story", "1"]));
  }
}

class ToneFilter extends LabelGroup {
  readonly param = "tone";
  constructor() {
    super(
      "Tone",
      labels(
        ["Comedy", "0"],
        ["Drama", "1"],
        // Label("N/A", "2"),
        ["Other", "3"],
      ),
    );
  }
}

class StyleFilter extends LabelGroup {
  readonly param = "style";
  constructor() {
    super("Art style", labels(["Cartoon", "0"], ["American", "1"], ["Manga", "2"], ["Realism", "3"], ["Sprite", "4"], ["Sketch", "5"], ["Experimental", "6"], ["Photographic", "7"], ["Stick Figure", "8"]));
  }
}

class GenreFilter extends LabelGroup {
  readonly param = "genre";
  constructor() {
    super(
      "Genre",
      labels(
        ["Fantasy", "0"],
        ["Parody", "1"],
        ["Real Life", "2"],
        ["Sci-Fi", "4"],
        ["Horror", "5"],
        ["Abstract", "6"],
        ["Adventure", "8"],
        ["Noir", "9"],
        // Label("N/A", "10"),
        // Label("N/A", "11"),
        ["Political", "12"],
        ["Spiritual", "13"],
        ["Romance", "14"],
        ["Superhero", "15"],
        ["Western", "16"],
        ["Mystery", "17"],
        ["War", "18"],
        ["Tribute", "19"],
      ),
    );
  }
}

class RatingFilter extends LabelGroup {
  readonly param = "rating";
  constructor() {
    super("Rating", labels(["Everyone", "E"], ["Teen", "T"], ["Mature", "M"], ["Adult", "A"]));
  }
}

const updateLabels: Record<string, string> = { Any: "", Today: "today", "Last week": "week", "Last month": "month" };

class UpdateFilter extends Filter.Select<string> implements QueryParam {
  readonly param = "last_update";
  constructor() {
    super("Last update", Object.keys(updateLabels));
  }
  encode(url: HttpUrlBuilder): void {
    url.addQueryParameter(this.param, updateLabels[this.values[this.state]]);
  }
}

const isQueryParam = (f: Filter): f is Filter & QueryParam => f instanceof LabelGroup || f instanceof UpdateFilter;

export default class TheDuckWebcomics extends KeiSource {
  async getPopularManga(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/search/?page=${page}`)).asJsoup();
    return this.parseMangaList(document);
  }

  private parseMangaList(document: Document): MangasPage {
    const mangas = document.select(".breadcrumb ~ div[style]").map((element) => {
      const manga = SManga.create();
      const titleEl = element.selectFirst(".size24");
      if (!titleEl) throw new Error("Title element not found");
      manga.title = titleEl.text();
      manga.url = urlWithoutDomain(titleEl.absUrl("href"));

      const genre = element.selectFirst(".size10")?.text();
      manga.genre = genre == null ? undefined : substringBefore(genre, ",");
      manga.description = element.selectFirst(".comicdescparagraphs")?.text();
      manga.thumbnail_url = element.selectFirst("img")?.absUrl("src");
      manga.author = element.selectFirst(".size18")?.text();
      manga.artist = manga.author;
      return manga;
    });
    const hasNextPage = document.selectFirst("a.next") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    const document = (await this.client.get(`${this.baseUrl}/search/?page=${page}&last_update=today`)).asJsoup();
    return this.parseMangaList(document);
  }

  async getSearchMangaList(page: number, query: string, filters: FilterList): Promise<MangasPage> {
    const url = toHttpUrl(`${this.baseUrl}/search`).newBuilder();
    url.addQueryParameter("search", query);
    url.addQueryParameter("page", String(page));
    for (const it of filters.filter(isQueryParam)) it.encode(url);
    const document = (await this.client.get(url.build().toString())).asJsoup();
    return this.parseMangaList(document);
  }

  // The details are only available in search
  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    manga.initialized = true;

    let chapterList = chapters;
    if (fetchChapters) {
      const document = (await this.client.get(this.baseUrl + manga.url)).asJsoup();

      const error = document.selectFirst(".yellow-box > .paranomargin")?.text();
      if (error != null) throw new Error(error);
      chapterList = document.select("#page_dropdown > option").map((el, idx) => {
        const chapter = SChapter.create();
        chapter.chapter_number = idx + 1;
        chapter.name = substringAfter(el.text(), "- ");
        chapter.url = urlWithoutDomain(`${el.absUrl("value")}/`);
        return chapter;
      });
    }

    return new SMangaUpdate(manga, chapterList);
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const document = (await this.client.get(this.baseUrl + chapter.url)).asJsoup();
    const imageUrl = document.selectFirst(".page-image")?.absUrl("src");
    if (!imageUrl) throw new Error("Page image not found");
    return [new Page(0, "", imageUrl)];
  }

  override getFilterList(_data: unknown = null): FilterList {
    return FilterList(new TypeFilter(), new ToneFilter(), new StyleFilter(), new GenreFilter(), new RatingFilter(), new UpdateFilter());
  }
}
