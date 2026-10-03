// Port of keiyoushi/extensions-source src/all/twicomi/Twicomi.kt (+ Dto.kt)
import {
  DateTimeFormatter,
  Filter,
  FilterList,
  KeiSource,
  Locale,
  MangasPage,
  Page,
  SChapter,
  SManga,
  SMangaUpdate,
  ZoneId,
  firstInstanceOrNull,
  substringAfter,
  substringBefore,
  toHttpUrl,
  type FilterList as FilterListType,
  type HttpUrl,
  type HttpUrlBuilder,
} from "../../../sdk/index.ts";

// --- Dto.kt
const dateFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.US);
const tokyoZone = ZoneId.of("Asia/Tokyo");

interface TwicomiResponse<T> {
  response: T;
}
interface MangaListWithCount {
  total_count: number;
  manga_list: MangaListItem[];
}
interface MangaListItem {
  author: AuthorDto;
  tweet: TweetDto;
}
interface AuthorListWithCount {
  total_count: number;
  author_list: AuthorWrapperDto[];
}
interface AuthorWrapperDto {
  author: AuthorDto;
}
interface AuthorDto {
  screen_name: string;
  name: string;
  description?: string | null;
  profile_image?: string | null;
}
interface TweetDto {
  tweet_id: string;
  tweet_text: string;
  attach_image_urls: string[];
  tags: string[];
  hash_tags: string[];
  tweet_create_time: string;
}

function mangaToSManga(item: MangaListItem): SManga {
  const { author: tweetAuthor, tweet } = item;
  const timestamp = dateFormat.tryParseDateTime(tweet.tweet_create_time, tokyoZone);
  const extraData = `${timestamp},${tweet.attach_image_urls.join(", ")}`;

  const manga = SManga.create();
  manga.url = `/manga/${tweetAuthor.screen_name}/${tweet.tweet_id}#${extraData}`;
  manga.title = tweet.tweet_text.split("\n")[0];
  manga.author = `${tweetAuthor.name} (@${tweetAuthor.screen_name})`;
  manga.description = tweet.tweet_text;
  manga.genre = [...tweet.hash_tags, ...tweet.tags].join(", ");
  manga.status = SManga.COMPLETED;
  // update_strategy = ONLY_FETCH_ONCE has no counterpart in our SManga
  manga.thumbnail_url = tweet.attach_image_urls[0];
  manga.initialized = true;
  return manga;
}

function authorToSManga(a: AuthorDto): SManga {
  const manga = SManga.create();
  manga.url = `/author/${a.screen_name}`;
  manga.title = a.name;
  manga.author = a.screen_name;
  manga.description = a.description ?? undefined;
  manga.thumbnail_url = a.profile_image ?? undefined;
  manga.initialized = true;
  return manga;
}

// --- Twicomi.kt
class TypeSelect extends Filter.Select<string> {
  constructor() {
    super("Search for", ["Tweet", "Author"]);
  }
}

interface Sortable {
  title: string;
  value: string;
}

class SortFilter extends Filter.Sort {
  constructor(name: string, private readonly sortables: Sortable[], state: { index: number; ascending: boolean } | null = null) {
    super(name, sortables.map((it) => it.title), state);
  }
  addToUrl(url: HttpUrlBuilder) {
    if (this.state == null) return;

    const query = this.sortables[this.state.index].value;
    const order = this.state.ascending ? "asc" : "desc";

    url.addQueryParameter("order_by", query);
    url.addQueryParameter("order", order);
  }
}

class MangaSortFilter extends SortFilter {
  constructor() {
    super(
      "Sort (Tweet)",
      [
        { title: "Date", value: "create_time" },
        { title: "Retweets", value: "retweet_count" },
        { title: "Likes", value: "good_count" },
      ],
      { index: 0, ascending: false },
    );
  }
}

class AuthorSortFilter extends SortFilter {
  constructor() {
    super(
      "Sort (Author)",
      [
        { title: "Followers", value: "follower_count" },
        { title: "Tweets", value: "manga_tweet_count" },
        { title: "Recently tweeted", value: "latest_manga_tweet_time" },
      ],
      { index: 0, ascending: false },
    );
  }
}

export default class Twicomi extends KeiSource {
  private readonly apiUrl = "https://api.twicomi.com/api/v2";

  async getPopularManga(page: number): Promise<MangasPage> {
    return this.getMangaList(toHttpUrl(`${this.apiUrl}/manga/featured/list?page_no=${page}&page_limit=24`)!);
  }

  async getLatestUpdates(page: number): Promise<MangasPage> {
    return this.getMangaList(toHttpUrl(`${this.apiUrl}/manga/list?order_by=create_time&page_no=${page}&page_limit=24`)!);
  }

  private async getMangaList(url: HttpUrl): Promise<MangasPage> {
    const data = (await this.client.get(url.toString())).parseAs<TwicomiResponse<MangaListWithCount>>();
    const manga = data.response.manga_list.map((it) => mangaToSManga(it));

    return new MangasPage(manga, this.hasNextPage(url, data.response.total_count));
  }

  async getSearchMangaList(page: number, query: string, filters: FilterListType): Promise<MangasPage> {
    const searchAuthors = firstInstanceOrNull(filters, TypeSelect)?.state === 1;

    const b = toHttpUrl(this.apiUrl)!.newBuilder();
    if (searchAuthors) {
      b.addPathSegment("author");
      firstInstanceOrNull(filters, AuthorSortFilter)?.addToUrl(b);
    } else {
      b.addPathSegment("manga");
      firstInstanceOrNull(filters, MangaSortFilter)?.addToUrl(b);
    }

    b.addPathSegment("list");

    if (query.trim()) b.addQueryParameter("query", query);

    b.addQueryParameter("page_no", String(page));
    b.addQueryParameter("page_limit", "12");
    const url = b.build();

    if (!searchAuthors) return this.getMangaList(url);

    const data = (await this.client.get(url.toString())).parseAs<TwicomiResponse<AuthorListWithCount>>();
    const manga = data.response.author_list.map((it) => authorToSManga(it.author));

    return new MangasPage(manga, this.hasNextPage(url, data.response.total_count));
  }

  private hasNextPage(url: HttpUrl, totalCount: number): boolean {
    const currentPage = Number.parseInt(url.queryParameter("page_no")!, 10);
    const pageLimit = url.queryParameter("page_limit") != null ? Number.parseInt(url.queryParameter("page_limit")!, 10) : 10;
    return currentPage * pageLimit < totalCount;
  }

  override getMangaUrl(manga: SManga): string {
    switch (manga.url.split("/")[1]) {
      case "author":
        return `${this.baseUrl}${manga.url}/page/1`;
      case "manga":
        return this.baseUrl + substringBefore(manga.url, "#");
      default:
        throw new Error("IllegalArgumentException");
    }
  }

  override getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + substringBefore(chapter.url, "#");
  }

  async fetchMangaUpdate(manga: SManga, chapters: SChapter[], _fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const splitUrl = manga.url.split("/");

    let chapterList: SChapter[];
    switch (splitUrl[1]) {
      case "manga":
        chapterList = [this.dummyChapterFromManga(manga)];
        break;
      case "author":
        chapterList = fetchChapters ? await this.getAuthorChapterList(splitUrl[2]) : chapters;
        break;
      default:
        throw new Error("IllegalArgumentException");
    }

    return new SMangaUpdate(manga, chapterList);
  }

  private async getAuthorChapterList(screenName: string): Promise<SChapter[]> {
    const pageLimit = 500;
    const results: MangaListItem[] = [];
    let page = 0;
    let totalCount: number;

    do {
      page += 1;

      const url = `${this.apiUrl}/author/manga/list?screen_name=${screenName}&order_by=create_time&order=asc&page_no=${page}&page_limit=${pageLimit}`;
      const data = (await this.client.get(url)).parseAs<TwicomiResponse<MangaListWithCount>>();

      results.push(...data.response.manga_list);
      totalCount = data.response.total_count;
    } while (page * pageLimit < totalCount);

    return results
      .map((it, i) => {
        const c = this.dummyChapterFromManga(mangaToSManga(it));
        c.name = it.tweet.tweet_text.split("\n")[0];
        c.chapter_number = i + 1;
        return c;
      })
      .reverse();
  }

  private dummyChapterFromManga(manga: SManga): SChapter {
    const c = SChapter.create();
    c.url = manga.url;
    c.name = "Tweet";
    c.date_upload = Number(substringBefore(substringAfter(manga.url, "#"), ","));
    return c;
  }

  async getPageList(chapter: SChapter): Promise<Page[]> {
    const urls = substringAfter(chapter.url, "#").split(",").slice(1);
    return urls.map((it, i) => new Page(i, "", it));
  }

  override getFilterList(_data: unknown = null): FilterListType {
    return FilterList(new TypeSelect(), new MangaSortFilter(), new AuthorSortFilter());
  }
}
