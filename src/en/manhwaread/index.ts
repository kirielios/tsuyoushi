// Port of keiyoushi/extensions-source src/en/manhwaread/ManhwaRead.kt
import {
  Base64,
  DateTimeFormatter,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SManga,
  SMangaUpdate,
  fromUtf8,
  parseAs,
  toHttpUrl,
  urlWithoutDomain,
  type Element,
  type FilterList,
  SChapter,
} from "../../../sdk/index.ts";
import type { ChapterData, ChapterDataData } from "./dto.ts";
import {
  ArtistsFilter,
  AuthorsFilter,
  ChapterNumbersFilter,
  GenresFilter,
  KeywordModeFilter,
  PublishYearFilter,
  PublishersFilter,
  SortByFilter,
  StatusFilter,
  TagsFilter,
  TagsSearchModeFilter,
  getFilters,
} from "./filters.ts";

const PATTERN_CHAPTER_DATA = /var\s+chapterData\s*=\s*(\{.*\})/;

// Kotlin's String.toIntOrNull / toDoubleOrNull (no whitespace trimming, unlike Number())
const toIntOrNull = (s: string) =>
  /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
const toDoubleOrNull = (s: string) =>
  /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? parseFloat(s) : null;

export default class ManhwaRead extends KeiSource {
  private readonly dateFormat = DateTimeFormatter.ofPattern(
    "d/M/yyyy",
    Locale.ROOT,
  );

  // Popular
  async getPopularManga(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", SortByFilter.POPULAR);
  }

  // Latest
  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getSearchMangaList(page, "", SortByFilter.LATEST);
  }

  // Search
  protected override async getMangaByUrl(url: URL): Promise<SManga | null> {
    const pathSegments = url.pathname
      .slice(1)
      .split("/")
      .map(decodeURIComponent);
    if (pathSegments[0] !== "manhwa") return null;
    const slug = pathSegments[1];
    if (!slug) return null;

    // Rewrite to strip suffixes after slug
    const manga = SManga.create();
    manga.url = `/manhwa/${slug}/`;
    return (await this.fetchMangaUpdate(manga, [], true, false)).manga;
  }

  async getSearchMangaList(
    page: number,
    query: string,
    filters: FilterList,
  ): Promise<MangasPage> {
    const urlBuilder = toHttpUrl(this.baseUrl).newBuilder();
    if (page > 1) {
      urlBuilder.addPathSegment("page");
      urlBuilder.addPathSegment(String(page));
      urlBuilder.addPathSegment("");
    }
    urlBuilder.addQueryParameter("s", query);

    for (const filter of filters) {
      if (filter instanceof SortByFilter) {
        urlBuilder.addQueryParameter(filter.queryName, filter.queryValue);
        urlBuilder.addQueryParameter("order", filter.orderValue);
      } else if (filter instanceof KeywordModeFilter)
        urlBuilder.addQueryParameter(filter.queryName, filter.queryValue);
      else if (filter instanceof TagsSearchModeFilter)
        urlBuilder.addQueryParameter(filter.queryName, filter.queryValue);
      else if (filter instanceof StatusFilter)
        urlBuilder.addQueryParameter(filter.queryName, filter.queryValue);
      else if (filter instanceof ArtistsFilter)
        filter.queryValues.forEach((it) =>
          urlBuilder.addQueryParameter(filter.queryName, it),
        );
      else if (filter instanceof AuthorsFilter)
        filter.queryValues.forEach((it) =>
          urlBuilder.addQueryParameter(filter.queryName, it),
        );
      else if (filter instanceof PublishersFilter)
        filter.queryValues.forEach((it) =>
          urlBuilder.addQueryParameter(filter.queryName, it),
        );
      else if (filter instanceof GenresFilter)
        filter.queryValues.forEach((it) =>
          urlBuilder.addQueryParameter(filter.queryName, it),
        );
      else if (filter instanceof TagsFilter) {
        filter.includedQueryValues.forEach((it) =>
          urlBuilder.addQueryParameter(filter.includedQueryName, it),
        );
        filter.excludedQueryValues.forEach((it) =>
          urlBuilder.addQueryParameter(filter.excludedQueryName, it),
        );
      } else if (filter instanceof PublishYearFilter)
        urlBuilder.addQueryParameter(filter.queryName, filter.queryValue);
      else if (filter instanceof ChapterNumbersFilter)
        urlBuilder.addQueryParameter(filter.queryName, filter.queryValue);
    }

    const document = (
      await this.client.get(urlBuilder.build().toString())
    ).asJsoup();
    const mangas = document
      .select(".main-container .manga-item")
      .map((it) => this.searchMangaFromElement(it));
    const hasNextPage = document.selectFirst(".wp-pagenavi a.last") != null;
    return new MangasPage(mangas, hasNextPage);
  }

  private searchMangaFromElement(element: Element): SManga {
    const manga = SManga.create();
    const link = element.selectFirst("a.manga-item__link")!;
    manga.url = urlWithoutDomain(link.absUrl("href"));
    manga.title = link.text();
    manga.thumbnail_url = element
      .selectFirst(".manga-item__img img")
      ?.absUrl("src");
    return manga;
  }

  // Details
  async fetchMangaUpdate(
    manga: SManga,
    _chapters: SChapter[],
    _fetchDetails: boolean,
    _fetchChapters: boolean,
  ): Promise<SMangaUpdate> {
    const document = (await this.client.get(this.getMangaUrl(manga))).asJsoup();
    manga.title = document
      .selectFirst("#mangaSummary .manga-titles h1")!
      .text();
    manga.artist = document
      .select(
        "#mangaSummary .text-primary:contains(Artist:) + .flex a span:first-child",
      )
      .map((it) => it.text())
      .join(", ");
    manga.author = document
      .select(
        "#mangaSummary .text-primary:contains(Author:) + .flex a span:first-child",
      )
      .map((it) => it.text())
      .join(", ");

    let description = "";
    const metrics = document.selectFirst("div:has(> #mangaRating)");
    const rating = metrics
      ?.selectFirst("#mangaRating .rating__current")
      ?.text();
    if (rating != null) {
      const ratingCount = metrics!
        .selectFirst("#mangaRating .rating__count")
        ?.text();
      if (ratingCount != null) {
        const ratingString = this.getRatingString(
          rating,
          toIntOrNull(ratingCount) ?? 0,
        );
        if (ratingString) {
          if (description) description += "\n";
          description += "Rating: " + ratingString;
        }
      }
    }
    const views = metrics?.selectFirst(".fa-eye + span")?.text();
    if (views != null) {
      if (description) description += "\n";
      description += "Views: " + views;
    }
    const comments = metrics?.selectFirst(".fa-comments + span")?.text();
    if (comments != null) {
      if (description) description += "\n";
      description += "Comments: " + comments;
    }
    const bookmarks = metrics?.selectFirst(".w-5.h-5 + span")?.text();
    if (bookmarks != null) {
      if (description) description += "\n";
      description += "Bookmarks: " + bookmarks;
    }

    const publisher = document.select(
      "#mangaSummary .text-primary:contains(Publisher:) + .flex a span:first-child",
    );
    if (publisher.length) {
      if (description) description += "\n";
      const publishers = publisher.map((it) => it.text()).join(", ");
      const publisherLabel = publisher.length > 1 ? "Publishers" : "Publisher";
      description += publisherLabel + ": " + publishers;
    }

    const desc = document
      .selectFirst("#mangaDesc > .manga-desc__content")
      ?.text();
    if (desc != null) {
      if (description) description += "\n\n";
      description += desc;
    }

    const altTitlesText = document
      .selectFirst("#mangaSummary .manga-titles h2")
      ?.text();
    if (altTitlesText) {
      const altTitles = altTitlesText
        .split("|")
        .map((it) => "- " + it.trim())
        .join("\n");
      if (description) description += "\n\n";
      description += "Alternative titles:\n" + altTitles;
    }
    manga.description = description;

    const siteGenres = document
      .select("#mangaSummary .manga-genres a")
      .map((it) => it.text());
    const siteTags = document
      .select(
        "#mangaSummary .text-primary:contains(Tags:) + .flex a span:first-child",
      )
      .map((it) => it.text());
    manga.genre = [...siteGenres, ...siteTags].join(", ");

    const statusText = document
      .selectFirst("#mangaSummary .manga-status")
      ?.attr("data-status");
    switch (statusText) {
      case "ongoing":
        manga.status = SManga.ONGOING;
        break;
      case "completed":
        manga.status = SManga.COMPLETED;
        break;
      case "canceled":
        manga.status = SManga.CANCELLED;
        break;
      case "on-hold":
        manga.status = SManga.ON_HIATUS;
        break;
      case "incomplete":
        manga.status = SManga.PUBLISHING_FINISHED;
        break;
      default:
        manga.status = SManga.UNKNOWN;
    }

    manga.thumbnail_url = document
      .selectFirst("head meta[property=og:image]")
      ?.absUrl("content");

    const chapterList = document
      .select("#chaptersList > a.chapter-item")
      .map((it) => this.chapterFromElement(it))
      .reverse();

    return new SMangaUpdate(manga, chapterList);
  }

  private chapterFromElement(element: Element): SChapter {
    const chapter = SChapter.create();
    chapter.url = urlWithoutDomain(element.absUrl("href"));
    chapter.name = element.selectFirst("span.chapter-item__name")!.text();
    chapter.date_upload = this.dateFormat.tryParseDate(
      element.selectFirst("span.chapter-item__date")?.text(),
    );
    return chapter;
  }

  // Pages
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const body = (await this.client.get(this.getChapterUrl(chapter))).text();
    const chapterDataString = PATTERN_CHAPTER_DATA.exec(body)?.[1];
    if (chapterDataString == null) throw new Error("Chapter data not found");

    const chapterData = parseAs<ChapterData>(chapterDataString);
    const chapterDataData = fromUtf8(Base64.decode(chapterData.data));
    const pages = parseAs<ChapterDataData[]>(chapterDataData);

    return pages.map(
      (page, index) => new Page(index, "", `${chapterData.base}/${page.src}`),
    );
  }

  // Other
  getFilterList(_data: unknown = null): FilterList {
    return getFilters();
  }

  private getRatingString(rate: string, rateCount: number): string {
    const ratingValue = toDoubleOrNull(rate) ?? 0.0;
    let ratingStar: string;
    if (ratingValue >= 4.75) ratingStar = "★★★★★";
    else if (ratingValue >= 4.25) ratingStar = "★★★★✬";
    else if (ratingValue >= 3.75) ratingStar = "★★★★☆";
    else if (ratingValue >= 3.25) ratingStar = "★★★✬☆";
    else if (ratingValue >= 2.75) ratingStar = "★★★☆☆";
    else if (ratingValue >= 2.25) ratingStar = "★★✬☆☆";
    else if (ratingValue >= 1.75) ratingStar = "★★☆☆☆";
    else if (ratingValue >= 1.25) ratingStar = "★✬☆☆☆";
    else if (ratingValue >= 0.75) ratingStar = "★☆☆☆☆";
    else if (ratingValue >= 0.25) ratingStar = "✬☆☆☆☆";
    else ratingStar = "☆☆☆☆☆";

    if (ratingValue > 0.0) {
      let s = `${ratingStar} ${rate}`;
      if (rateCount > 0) s += ` (${rateCount})`;
      return s;
    }
    return "";
  }
}
