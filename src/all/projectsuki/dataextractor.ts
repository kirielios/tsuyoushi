// Port of keiyoushi/extensions-source src/all/projectsuki/DataExtractor.kt
//
// Jsoup identity maps (Map<Element, …>) are keyed by the underlying DOM node here, since the SDK wraps nodes anew
// on every select. `unexpectedErrorCatchingLazy` becomes a memoised getter that rewraps unexpected errors the same way.
import { DateTimeFormatter, Locale, ZoneOffset, ago, toHttpUrl, toHttpUrlOrNull, type Element, type HttpUrl } from "../../../sdk/index.ts";
import { imageSrc } from "./api.ts";
import {
  ProjectSukiException,
  UNKNOWN_LANGUAGE,
  bookUrlPattern,
  chapterUrlPattern,
  genreSearchUrlPattern,
  homepageUrl,
  matchAgainst,
  reportErrorToUser,
  thumbnailUrlPattern,
  type BookID,
  type PathMatchResult,
  type ScanGroup,
} from "./pathpattern.ts";

/** unexpectedErrorCatchingLazy: non-ProjectSuki exceptions are reported with a location hint. */
function catching<R>(location: string, initializer: () => R): R {
  try {
    return initializer();
  } catch (exception) {
    if (!(exception instanceof ProjectSukiException)) {
      const e = exception as Error;
      reportErrorToUser(location, () => `Unexpected ${e?.constructor?.name ?? "Error"}: ${e?.message ?? "<no message>"}`);
    }
    throw exception;
  }
}

export function bookThumbnailUrl(bookID: BookID, extension: string, size: number | null = null): HttpUrl {
  let last: string;
  if (size == null && !extension.trim()) last = "thumb";
  else if (size == null) last = `thumb.${extension}`;
  else if (!extension.trim()) last = `${size}-thumb`;
  else last = `${size}-thumb.${extension}`;
  return homepageUrl.newBuilder().addPathSegment("images").addPathSegment("gallery").addPathSegment(bookID).addPathSegment(last).build();
}

/** Jsoup's Element.parents(): ancestors from the parent up to <html>, without the document. */
export function parents(element: Element): Element[] {
  const out: Element[] = [];
  for (let p = element.parent(); p && (p.node as { type?: string }).type === "tag"; p = p.parent()) out.push(p);
  return out;
}

export function nearestCommonParent(elements: Element[]): Element | null {
  if (elements.length < 2) return null;

  const chains = elements.map((it) => parents(it).reverse());
  let lastCommon: Element | null = null;

  for (let depth = 0; ; depth++) {
    const layer: (Element | null)[] = chains.map((it) => it[depth] ?? null);
    if (layer.includes(null)) break;
    if (new Set(layer.map((it) => it!.node)).size !== 1) break;
    lastCommon = layer[0];
  }

  return lastCommon;
}

interface SwitchingPoint {
  left: number;
  right: number;
  leftState: boolean;
  rightState: boolean;
}

function switchingPoints<E>(items: E[], predicate: (e: E) => boolean): SwitchingPoint[] {
  if (!items.length) return [];
  const points: SwitchingPoint[] = [];
  let state = predicate(items[0]);
  for (let index = 1; index < items.length; index++) {
    const p = predicate(items[index]);
    if (state !== p) {
      points.push({ left: index - 1, right: index, leftState: state, rightState: p });
      state = p;
    }
  }
  return points;
}

export interface PSBook {
  thumbnail: HttpUrl;
  rawTitle: string;
  bookUrl: HttpUrl;
  bookID: BookID;
}

export interface ProcessedData {
  label: string;
  detailData: string;
}

export interface PSBookDetails {
  book: PSBook;
  details: Map<BookDetail, ProcessedData>;
  alertData: string[];
  description: string;
}

const text = (element: Element) => element.text();
const anchorsWithQuery = (name: string) => (extractor: DataExtractor) =>
  [...extractor.psHrefAnchors.values()].filter(({ url }) => url.toURL().searchParams.has(name)).map(({ element }) => element);

export class BookDetail {
  constructor(
    readonly regex: RegExp,
    private readonly labelText: string,
    readonly detailsData: (element: Element) => string = text,
    readonly tryFind: (extractor: DataExtractor) => Element[] = () => [],
  ) {}
  label(_element: Element | null) {
    return this.labelText;
  }
  process(element: Element): ProcessedData {
    return { label: this.label(element), detailData: this.detailsData(element) };
  }

  static readonly AltTitle = new BookDetail(/(?:alternative|alt\.?) titles?:?/i, "Alt titles:");
  static readonly Author = new BookDetail(/authors?:?/i, "Authors:", text, anchorsWithQuery("author"));
  static readonly Artist = new BookDetail(/artists?:?/i, "Artists:", text, anchorsWithQuery("artist"));
  static readonly Status = new BookDetail(/status:?/i, "Status:", text, anchorsWithQuery("status"));
  static readonly Origin = new BookDetail(/origin:?/i, "Origin:", text, anchorsWithQuery("origin"));
  static readonly koreaRegex = /^(?:kr|korea\s*(?:\(south\))?)$/i;
  static readonly chinaRegex = /^(?:cn|china?)$/i;
  static readonly japanRegex = /^(?:jp|japan?)$/i;
  static readonly ReleaseYear = new BookDetail(/release(?: year):?/i, "Release year:");
  static readonly UserRating = new BookDetail(
    /user ratings?:?/i,
    "User rating:",
    (element) => {
      const rates = element.id() !== "ratings" ? 0 : element.children().filter((it) => it.hasClass("text-warning")).length;
      return rates >= 1 && rates <= 5 ? `${rates}/5` : "?/5";
    },
    (extractor) => [...extractor.extractionElement.select("#ratings")],
  );
  static readonly Views = new BookDetail(/views?:?/i, "Views:");
  static readonly Official = new BookDetail(/official:?/i, "Official:");
  static readonly Purchase = new BookDetail(/purchase:?/i, "Purchase:");
  static readonly Genre = new BookDetail(/genre(?:\(s\))?:?/i, "Genres:", text, (extractor) =>
    [...extractor.psHrefAnchors.values()].filter(({ url }) => matchAgainst(url, genreSearchUrlPattern).doesMatch).map(({ element }) => element),
  );

  static get all(): BookDetail[] {
    return [BookDetail.AltTitle, BookDetail.Author, BookDetail.Artist, BookDetail.Status, BookDetail.Origin, BookDetail.ReleaseYear, BookDetail.UserRating, BookDetail.Views, BookDetail.Official, BookDetail.Purchase, BookDetail.Genre];
  }
  static from(type: string): BookDetail | null {
    return BookDetail.all.find((it) => new RegExp(`^(?:${it.regex.source})$`, "i").test(type)) ?? null;
  }
}

type ColumnType = "Chapter" | "Group" | "Added" | "Language" | "Views";
const COLUMN_TYPES: { type: ColumnType; required: boolean; regex: RegExp }[] = [
  { type: "Chapter", required: true, regex: /^chapters?$/i },
  { type: "Group", required: true, regex: /^groups?$/i },
  { type: "Added", required: true, regex: /^(?:added|date)$/i },
  { type: "Language", required: false, regex: /^language$/i },
  { type: "Views", required: false, regex: /^views?(?:\s*count)?$/i },
];

function extractDataTypes(headers: Element[]): Map<ColumnType, number> {
  const map = new Map<ColumnType, number>();
  headers
    .map((it) => it.text())
    .forEach((columnHeaderText, columnIndex) => {
      for (const dataType of COLUMN_TYPES) if (dataType.regex.test(columnHeaderText)) map.set(dataType.type, columnIndex);
    });
  return map;
}

export interface ChapterNumber {
  main: number;
  sub: number;
}
export const compareChapterNumbers = (a: ChapterNumber, b: ChapterNumber) => a.main - b.main || a.sub - b.sub;
const chapterNumberRegex = /(?:chapter|ch\.?)\s*(\d+)(?:\s*[.,-]\s*(\d+)?)?/i;

export interface BookChapter {
  chapterUrl: HttpUrl;
  chapterMatchResult: PathMatchResult;
  chapterTitle: string;
  chapterNumber: ChapterNumber | null;
  chapterGroup: ScanGroup;
  chapterDateAdded: number;
  chapterLanguage: string;
}

interface MissingChapterNumberEdge {
  index: number;
  aboveIsKnown: boolean;
  belowIsKnown: boolean;
}
function edge(index: number, aboveIsKnown: boolean, belowIsKnown: boolean): MissingChapterNumberEdge {
  if (!aboveIsKnown && !belowIsKnown) throw new Error("previous or next index must be known (or both)");
  return { index, aboveIsKnown, belowIsKnown };
}

// site uses abbreviated month names ("Jul 31, 2021"); the SDK's MMM accepts full names too ("[MMMM d, yyyy][MMM d, yyyy]")
const absoluteDateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
const relativeChapterDateRegex = /^(\d+)\s+(years?|months?|weeks?|days?|hours?|mins?|minutes?|seconds?|sec)\s+ago$/i;

function tryAnalyzeChapterDate(s: string): number {
  const match = relativeChapterDateRegex.exec(s.trim());
  if (!match) return absoluteDateFormat.tryParseDate(s.trim(), ZoneOffset.UTC);

  const number = Number.parseInt(match[1], 10);
  const relativity = match[2].toLowerCase();
  if (relativity.startsWith("year")) return ago(number, "years");
  if (relativity.startsWith("month")) return ago(number, "months");
  if (relativity.startsWith("week")) return ago(number, "weeks");
  if (relativity.startsWith("day")) return ago(number, "days");
  if (relativity.startsWith("hour")) return ago(number, "hours");
  if (relativity.startsWith("min")) return ago(number, "minutes");
  if (relativity.startsWith("sec")) return ago(number, "seconds");
  return Date.now();
}

function tryAnalyzeChapterNumber(s: string): ChapterNumber | null {
  const m = chapterNumberRegex.exec(s);
  if (!m) return null;
  return { main: Number.parseInt(m[1], 10), sub: m[2]?.trim() ? Number.parseInt(m[2], 10) : 0 };
}

const eqCN = (a: ChapterNumber, b: ChapterNumber) => compareChapterNumbers(a, b) === 0;
const predictBelow = (n: ChapterNumber): ChapterNumber => (n.sub === 0 ? { main: n.main - 1, sub: 0 } : n.sub === 5 ? { main: n.main, sub: 0 } : { main: n.main, sub: n.sub - 1 });
const predictAbove = (n: ChapterNumber): ChapterNumber => (n.sub === 0 || n.sub === 5 ? { main: n.main + 1, sub: 0 } : { main: n.main, sub: n.sub + 1 });

function tryInferMissingChapterNumbers(chapters: BookChapter[]): BookChapter[] {
  if (!chapters.length) return [];

  const points = switchingPoints(chapters, (it) => it.chapterNumber != null);
  const edges: MissingChapterNumberEdge[] = [];

  if (!points.length && chapters[0].chapterNumber == null) reportErrorToUser(null, () => "No chapter numbers could be inferred!");
  if (!points.length) return chapters;

  for (const { left, right, leftState: leftIsKnown, rightState: rightIsKnown } of points) {
    if (leftIsKnown && !rightIsKnown) edges.push(edge(right, true, false));
    else {
      const last = edges.at(-1);
      if (last?.index === left) edges[edges.length - 1] = edge(left, true, true);
      else edges.push(edge(left, false, true));
    }
  }

  const result = [...chapters];
  while (edges.length) {
    const e = edges.shift()!;
    const indexAbove = e.index - 1;
    const indexBelow = e.index + 1;

    if (e.aboveIsKnown && e.belowIsKnown) {
      const above = result[indexAbove].chapterNumber!;
      const below = result[indexBelow].chapterNumber!;
      const inferredByDecreasing = predictBelow(above);
      const inferredByIncreasing = predictAbove(below);

      if (eqCN(above, below)) reportErrorToUser(null, () => "Chapter number inference failed (case 0)!");
      else if (compareChapterNumbers(above, below) < 0) reportErrorToUser(null, () => "Chapter number inference failed (case 1)!");
      else if (eqCN(inferredByDecreasing, inferredByIncreasing)) result[e.index] = { ...result[e.index], chapterNumber: inferredByDecreasing };
      else if (compareChapterNumbers(inferredByIncreasing, above) >= 0 || compareChapterNumbers(inferredByDecreasing, below) <= 0) reportErrorToUser(null, () => "Chapter number inference failed (case 2)!");
      else if (compareChapterNumbers(inferredByDecreasing, inferredByIncreasing) > 0) result[e.index] = { ...result[e.index], chapterNumber: inferredByIncreasing };
      else reportErrorToUser(null, () => "Chapter number inference failed (case 3)!");
    } else if (e.aboveIsKnown) {
      const above = result[indexAbove].chapterNumber!;
      result[e.index] = { ...result[e.index], chapterNumber: predictBelow(above) };

      if (edges[0]?.index === e.index + 1) {
        const removed = edges.shift()!;
        edges.unshift({ ...removed, aboveIsKnown: true, belowIsKnown: false });
      } else if (indexBelow < result.length) {
        // upstream queues indexBelow unconditionally and then fails with an IndexOutOfBounds on the last row;
        // this can only be reached when the row below is unknown, i.e. exists
        edges.push(edge(indexBelow, true, false));
      }
    } else if (e.belowIsKnown) {
      const below = result[e.index + 1].chapterNumber!;
      result[e.index] = { ...result[e.index], chapterNumber: predictAbove(below) };

      if (edges.at(-1)?.index === e.index - 1) {
        const removed = edges.pop()!;
        edges.push({ ...removed, aboveIsKnown: true, belowIsKnown: true });
      } else if (indexAbove >= 0) {
        edges.push(edge(indexAbove, false, true));
      }
    } else reportErrorToUser(null, () => "Chapter number inference failed (case 4)!");
  }

  return result;
}

const displayNoneRegex = /display: ?none;?/i;

export class DataExtractor {
  private readonly url: HttpUrl;

  constructor(readonly extractionElement: Element) {
    this.url =
      toHttpUrlOrNull(extractionElement.location()) ??
      reportErrorToUser(null, () => `DataExtractor class requires an "extractionElement" element that possesses an owner document with a valid absolute location(), but ${extractionElement.location()} was found!`);
  }

  private memo = new Map<string, unknown>();
  private lazy<R>(name: string, init: () => R): R {
    if (!this.memo.has(name)) this.memo.set(name, catching(`DataExtractor.${name}`, init));
    return this.memo.get(name) as R;
  }

  /** Map<Element, HttpUrl>, keyed by DOM node */
  get allHrefAnchors(): Map<unknown, { element: Element; url: HttpUrl }> {
    return this.lazy("allHrefAnchors", () => {
      const map = new Map<unknown, { element: Element; url: HttpUrl }>();
      for (const a of this.extractionElement.select("a[href]")) {
        const href = a.attr("abs:href");
        if (href.trim()) {
          const url = toHttpUrlOrNull(href);
          if (url) map.set(a.node, { element: a, url });
        }
      }
      return map;
    });
  }

  get psHrefAnchors(): Map<unknown, { element: Element; url: HttpUrl }> {
    return this.lazy("psHrefAnchors", () => new Map([...this.allHrefAnchors].filter(([, { url }]) => url.host.endsWith(homepageUrl.host))));
  }

  get books(): PSBook[] {
    return this.lazy("books", () => {
      const groups = new Map<BookID, { container: Element; href: HttpUrl; matchResult: PathMatchResult }[]>();
      for (const { element, url } of this.psHrefAnchors.values()) {
        const matchResult = matchAgainst(url, bookUrlPattern);
        if (!matchResult.doesMatch) continue;
        const id = matchResult.group(1)!;
        groups.set(id, [...(groups.get(id) ?? []), { container: element, href: url, matchResult }]);
      }

      const out: PSBook[] = [];
      for (const [bookID, containers] of groups) {
        let extension = "";
        outer: for (const c of containers) {
          for (const img of c.container.select("img")) {
            const src = imageSrc(img);
            if (!src) continue;
            const match = matchAgainst(src, thumbnailUrlPattern);
            if (match.doesMatch) {
              extension = match.group(3, 2) ?? "";
              break outer;
            }
          }
        }

        let title: string | null = null;
        for (const { container } of containers) {
          if (container.select("img").length === 0 && !parents(container).some((p) => p.tagName() === "small")) {
            const t = container.ownText();
            if (t.toLowerCase() !== "show more") {
              title = t;
              break;
            }
          }
        }
        if (title == null) reportErrorToUser("DataExtractor.books", () => `Could not determine title for ${bookID}`);

        out.push({
          thumbnail: bookThumbnailUrl(bookID, extension),
          rawTitle: title,
          bookUrl: homepageUrl.newBuilder().addPathSegment("book").addPathSegment(bookID).build(),
          bookID,
        });
      }
      return out;
    });
  }

  get bookDetails(): PSBookDetails {
    return this.lazy("bookDetails", () => {
      const match = matchAgainst(this.url, bookUrlPattern);
      if (!match.doesMatch) reportErrorToUser(null, () => `cannot extract book details: ${this.url}`);
      const bookID = match.group(1)!;

      const found = new Map<unknown, Element>();
      for (const detail of BookDetail.all) for (const e of detail.tryFind(this)) if (!found.has(e.node)) found.set(e.node, e);
      const detailsTable = nearestCommonParent([...found.values()]);
      const rows = detailsTable ? [...detailsTable.children()] : [];
      const details = new Map<BookDetail, ProcessedData>();

      for (const row of rows) {
        const cols = row.children();
        const typeElement = cols[0];
        const valueElement = cols[1];
        if (!typeElement || !valueElement) continue;
        const detail = BookDetail.from(typeElement.text());
        if (!detail) continue;
        details.set(detail, detail.process(valueElement));
      }

      const originData = details.get(BookDetail.Origin)?.detailData;
      let originGenre: string | null = null;
      if (originData != null) {
        if (BookDetail.koreaRegex.test(originData)) originGenre = "Manhwa";
        else if (BookDetail.chinaRegex.test(originData)) originGenre = "Manhua";
        else if (BookDetail.japanRegex.test(originData)) originGenre = "Manga";
      }
      if (originGenre != null) {
        const g = details.get(BookDetail.Genre);
        details.set(BookDetail.Genre, g ? { label: g.label, detailData: g.detailData.trim() ? `${g.detailData}, ${originGenre}` : originGenre } : { label: BookDetail.Genre.label(null), detailData: originGenre });
      }

      const title =
        this.extractionElement.selectFirst("h2[itemprop=title]") ??
        this.extractionElement.selectFirst("h2") ??
        detailsTable
          ?.parent()
          ?.parent()
          ?.children()
          .find((it) => ((it.node as { children?: { type: string }[] }).children ?? []).some((c) => c.type === "text")) ??
        null;

      const alerts = [...this.extractionElement.select(".alert, .alert-info")]
        .filter((it) => !displayNoneRegex.test(it.attr("style")))
        .filter((alert) => !parents(alert).some((it) => displayNoneRegex.test(it.attr("style"))))
        .map((alert) => {
          let s = "";
          let appendedSomething = false;
          const h4 = alert.select("h4");
          if (h4.length === 1) {
            s += `${h4[0].wholeText()}\n`;
            appendedSomething = true;
          }
          const p = alert.select("p");
          if (p.length === 1) {
            s += `${p[0].wholeText()}\n`;
            appendedSomething = true;
          }
          if (!appendedSomething) s += `${alert.wholeText()}\n`;
          return s;
        });

      const description =
        this.extractionElement.selectFirst("#descriptionCollapse")?.wholeText() ??
        this.extractionElement
          .select(".description")
          .map((it) => it.wholeText())
          .join("\n\n") + "\n";

      let extension = "";
      for (const e of this.extractionElement.select("img")) {
        const src = imageSrc(e);
        if (!src) continue;
        const matchUrl = matchAgainst(src, thumbnailUrlPattern);
        if (matchUrl.doesMatch) {
          extension = matchUrl.group(3, 2) ?? "";
          break;
        }
      }

      return {
        book: {
          thumbnail: bookThumbnailUrl(bookID, extension),
          rawTitle: title?.text() ?? reportErrorToUser("DataExtractor.bookDetails", () => `could not determine title for ${bookID}`),
          bookUrl: this.url,
          bookID,
        },
        details,
        alertData: alerts,
        description,
      };
    });
  }

  get bookChapters(): Map<ScanGroup, BookChapter[]> {
    return this.lazy("bookChapters", () => {
      const allChaptersByGroup = new Map<ScanGroup, BookChapter[]>();

      for (const tableElement of this.extractionElement.select("table")) {
        const thead = tableElement.selectFirst("thead");
        const tbody = tableElement.selectFirst("tbody");
        if (!thead || !tbody) continue;

        let columnDataTypes: Map<ColumnType, number> | null = null;
        for (const headerRow of thead.select("tr")) {
          const types = extractDataTypes([...headerRow.select("td")]);
          if (COLUMN_TYPES.filter((it) => it.required).every((it) => types.has(it.type))) {
            columnDataTypes = types;
            break;
          }
        }
        if (!columnDataTypes) continue;
        const cdt = columnDataTypes;

        const dataRows = [...tbody.select("tr")].map((it) => it.children()).filter((c) => c.length === cdt.size);
        const rawData = dataRows.map((row) => new Map([...cdt].map(([type, columnIndex]) => [type, row[columnIndex]] as const)));

        const rawByGroup = new Map<ScanGroup, Map<ColumnType, Element>[]>();
        for (const data of rawData) {
          const g = data.get("Group")!.text();
          rawByGroup.set(g, [...(rawByGroup.get(g) ?? []), data]);
        }

        for (const [groupName, chapters] of rawByGroup) {
          const bookChapters = chapters.map((data): BookChapter => {
            const chapterElement = data.get("Chapter")!;
            const addedElement = data.get("Added")!;
            const languageElement = data.get("Language");

            const a = chapterElement.selectFirst("a[href]") ?? reportErrorToUser(null, () => `Could not determine chapter url for ${chapterElement.text()}`);
            const chapterUrl = toHttpUrl(a.attr("abs:href"));
            return {
              chapterUrl,
              chapterMatchResult: matchAgainst(chapterUrl, chapterUrlPattern),
              chapterTitle: chapterElement.text(),
              chapterNumber: tryAnalyzeChapterNumber(chapterElement.text()),
              chapterGroup: groupName,
              chapterDateAdded: tryAnalyzeChapterDate(addedElement.text()),
              chapterLanguage: languageElement?.text()?.trim()?.toLowerCase() ?? UNKNOWN_LANGUAGE,
            };
          });
          const inferred = tryInferMissingChapterNumbers(bookChapters);
          allChaptersByGroup.set(groupName, [...(allChaptersByGroup.get(groupName) ?? []), ...inferred]);
        }
      }

      return allChaptersByGroup;
    });
  }
}
