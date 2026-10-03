// Port of keiyoushi/extensions-source src/all/projectsuki/ProjectSukiAPI.kt
import { MangasPage, Page, SManga, parseHtml, toHttpUrlOrNull, type Element, type Host, type HttpClient, type HttpUrl } from "../../../sdk/index.ts";
import { homepageUrl, matchAgainst, pageUrlPattern, rawRelative, reportErrorToUser, type BookID, type BookTitle, type ChapterID, type PathMatchResult } from "./pathpattern.ts";

export const callpageUrl = homepageUrl.newBuilder().addPathSegment("callpage").build();
export const apiBookSearchUrl = homepageUrl.newBuilder().addPathSegment("api").addPathSegment("book").addPathSegment("search").build();

const imageExtensions = [".jpg", ".png", ".jpeg", ".webp", ".gif", ".avif", ".tiff"];
const simpleSrcVariants = ["src", "data-src", "data-lazy-src"];

/**
 * Function that tries to extract the image URL from some known ways to store that information.
 */
export function imageSrc(element: Element): HttpUrl | null {
  for (const variant of simpleSrcVariants) {
    if (element.hasAttr(variant)) return toHttpUrlOrNull(element.attr(`abs:${variant}`));
  }

  if (element.hasAttr("srcset")) return toHttpUrlOrNull(element.attr("abs:srcset").split(" ")[0]);

  const attribs = (element.node as { attribs?: Record<string, string> }).attribs ?? {};
  const key = Object.entries(attribs).find(([k, v]) => k.includes("src") && imageExtensions.some((ext) => v.includes(ext)))?.[0];
  return key ? toHttpUrlOrNull(element.absUrl(key).split(" ")[0]) : null;
}

/**
 * Singleton responsible for handling API communications with Project Suki's server.
 *
 * @author Federico d'Alonzo &lt;me@npgx.dev&gt;
 */
export const ProjectSukiAPI = {
  /**
   * Requests the chapter's pages from the server.
   */
  async fetchChapterPages(client: HttpClient, host: Host, headers: Headers, bookID: BookID, chapterID: ChapterID): Promise<Page[]> {
    const newHeaders = new Headers(headers);
    newHeaders.append("X-Requested-With", "XMLHttpRequest");
    newHeaders.set("Content-Type", "application/json");

    // PagesRequestData(bookID, chapterID, "true")
    const body = JSON.stringify({ bookid: bookID, chapterid: chapterID, first: "true" });
    const response = await client.post(callpageUrl.toString(), newHeaders, body);
    return this.parseChapterPagesResponse(response.parseAs<{ src: string }>().src, host);
  },

  parseChapterPagesResponse(rawSrc: string, host: Host): Page[] {
    const srcFragment = parseHtml(host.load, rawSrc, homepageUrl.toString());

    const urls = new Map<string, { url: HttpUrl; match: PathMatchResult }>();
    for (const e of srcFragment.select("*")) {
      const url = imageSrc(e);
      if (!url) continue;
      const match = matchAgainst(url, pageUrlPattern);
      if (match.doesMatch) urls.set(url.toString(), { url, match });
    }

    if (urls.size === 0) reportErrorToUser(null, () => "chapter pages URLs aren't in the expected format!");

    return [...urls.values()]
      .sort((a, b) => Number.parseInt(a.match.group(4)!, 10) - Number.parseInt(b.match.group(4)!, 10))
      .map(({ url }, index) => new Page(index, "", url.toString()));
  },

  /**
   * Requests the complete list of books from the server.
   */
  async fetchBookSearch(client: HttpClient, headers: Headers): Promise<Map<BookID, BookTitle>> {
    const newHeaders = new Headers(headers);
    newHeaders.append("X-Requested-With", "XMLHttpRequest");
    newHeaders.set("Referer", homepageUrl.newBuilder().addPathSegment("browse").build().toString());
    newHeaders.set("Content-Type", "application/json");

    // SearchRequestData(null): the null default is not encoded
    const response = await client.post(apiBookSearchUrl.toString(), newHeaders, "{}");
    const dto = response.parseAs<{ data?: Record<string, { value: string }> }>();
    return new Map(Object.entries(dto.data ?? {}).map(([k, v]) => [k, v.value]));
  },
};

const alphaNumericRegex = /[\p{L}\p{N}]+/gu;

/**
 * Creates a [MangasPage] containing a sorted list of mangas from best match to words.
 */
export function simpleSearchMangasPage(books: Map<BookID, BookTitle>, searchQuery: string): MangasPage {
  const words = new Set(searchQuery.match(alphaNumericRegex) ?? []);

  const matches: { bookID: BookID; title: BookTitle; count: number }[] = [];
  for (const [bookID, bookTitle] of books) {
    const lower = bookTitle.toLowerCase();
    let matchesCount = 0;
    for (const word of words) {
      const w = word.toLowerCase();
      for (let idx = 0; ; ) {
        const found = lower.indexOf(w, idx);
        if (found < 0) break;
        idx = found + 1;
        matchesCount++;
      }
    }
    if (matchesCount > 0) matches.push({ bookID, title: bookTitle, count: matchesCount });
  }

  matches.sort((a, b) => b.count - a.count || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return toMangasPage(new Map(matches.map((m) => [m.bookID, m.title])));
}

export const bookIDToURL = (bookID: BookID): HttpUrl => homepageUrl.newBuilder().addPathSegment("book").addPathSegment(bookID).build();

export function toMangasPage(books: Map<BookID, BookTitle>, hasNextPage = false): MangasPage {
  return new MangasPage(
    [...books].map(([bookID, bookTitle]) => {
      const manga = SManga.create();
      manga.title = bookTitle;
      manga.url = rawRelative(bookIDToURL(bookID)) ?? reportErrorToUser(null, () => `Could not create relative url for bookID: ${bookID}`);
      // bookThumbnailUrl(bookID, "")
      manga.thumbnail_url = homepageUrl.newBuilder().addPathSegment("images").addPathSegment("gallery").addPathSegment(bookID).addPathSegment("thumb").build().toString();
      return manga;
    }),
    hasNextPage,
  );
}
