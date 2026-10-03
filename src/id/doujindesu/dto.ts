// Port of keiyoushi/extensions-source src/id/doujindesu/Dto.kt
import { SChapter, SManga, tryParseInstant, type Document } from "../../../sdk/index.ts";

/** Jsoup helpers the DTO conversions need, bound to the host's parser by the source. */
export interface JsoupHelpers {
  /** Parser.unescapeEntities(s, false) */
  unescapeEntities(s: string): string;
  /** Jsoup.parse / Jsoup.parseBodyFragment */
  parse(html: string): Document;
}

export interface TermsResult {
  terms: Term[];
}

export interface Term {
  slug: string;
}

export interface TaxonomyMangas {
  mangaList: MangaItem[];
  pagination: Pagination;
}

export interface Pagination {
  page: number;
  totalPages: number;
}

export interface MangaItem {
  title: string;
  slug: string;
  description?: string | null;
  author?: string | null;
  status: string;
  type: string;
  chapters: Chapter[];
  created_at: string;
  alt_titles?: string | null;
  term_list?: string | null;
  cover_url: string;
}

export const isCompleted = (m: MangaItem): boolean => ["completed", "finished"].includes(m.status.toLowerCase());

const cleanList = (list: string[] | undefined): string[] | null => {
  const r = list?.map((it) => it.trim()).filter((it) => it.length > 0 && it.toLowerCase() !== "n/a");
  return r && r.length > 0 ? r : null;
};
const orUnknown = (list: string[] | undefined): string => cleanList(list)?.join(", ") ?? "Tidak Diketahui";
const orNull = (list: string[] | undefined): string | null => cleanList(list)?.join(", ") ?? null;

export const synopsisRegex = /^\s*(?:sinopsis|synopsis)\s*:?\s*/i;
export const whitespaceRegex = /\s+/g;
export const textRegex = /<br\s*\/?>/gi;
export const chapterRegex = /^\d+(?:-\d+)?\.\s*.+$/;

const replaceFirstCharUpper = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const toTitleCase = (s: string): string => s.toLowerCase().split(/\s+/).map(replaceFirstCharUpper).join(" ");

export function mangaItemToSManga(item: MangaItem, baseUrl: string, jsoup: JsoupHelpers): SManga {
  const manga = SManga.create();
  const termMap = new Map<string, string[]>();
  item.term_list?.split("|").forEach((it) => {
    const parts = it.split(":");
    if (parts.length === 3) {
      if (!termMap.has(parts[1])) termMap.set(parts[1], []);
      termMap.get(parts[1])!.push(parts[0]);
    }
  });

  const itemAuthor = item.author;
  const mangaAuthor =
    (itemAuthor && itemAuthor.trim() && itemAuthor.toLowerCase() !== "n/a" ? itemAuthor : null) ??
    ["author", "artist", "author_artist", "creator"].map((key) => orNull(termMap.get(key))).find((it) => it != null) ??
    orNull(termMap.get("group"));

  manga.url = `/manga/${item.slug}/`;
  manga.title = item.title;
  manga.thumbnail_url = item.cover_url.startsWith("/") ? baseUrl + item.cover_url : item.cover_url;
  manga.author = mangaAuthor ?? undefined;

  const status = item.status.toLowerCase();
  if (["ongoing", "publishing"].includes(status)) manga.status = SManga.ONGOING;
  else if (isCompleted(item)) manga.status = SManga.COMPLETED;
  else if (status === "hiatus") manga.status = SManga.ON_HIATUS;
  else manga.status = SManga.UNKNOWN;

  let sb = "";
  const desc = item.description;
  let cleanDesc: string[] | null = null;
  if (desc && desc.trim()) {
    const document = jsoup.parse(jsoup.unescapeEntities(desc));
    const root = document.selectFirst(".rich-text-content") ?? document.selectFirst("body")!;

    const html = root.outerHtml().replace(textRegex, "%%BR%%");

    const text = jsoup.parse(html).text();

    const lines: string[] = [];

    for (const line of text.split("%%BR%%")) {
      let cleanLine = line.replace(whitespaceRegex, " ").trim();

      if (!cleanLine.trim()) continue;

      const lower = cleanLine.toLowerCase();

      const indices = [lower.indexOf("download batch"), lower.indexOf("download volume")].filter((it) => it >= 0);
      const downloadIndex = indices.length ? Math.min(...indices) : null;

      if (downloadIndex != null) cleanLine = cleanLine.substring(0, downloadIndex).trim();

      if (cleanLine.trim()) lines.push(cleanLine.replace(synopsisRegex, "").trim());

      if (downloadIndex != null) break;
    }

    const filtered = lines.filter((it) => it.trim());
    cleanDesc = filtered.length ? filtered : null;
  }

  if (cleanDesc != null) {
    const isChapterList = chapterRegex.test(cleanDesc[0]);

    sb += `\n\n**${isChapterList ? "Daftar Chapter" : "Sinopsis"}:**\n`;
    sb += cleanDesc.join(isChapterList ? "\n" : "\n\n");
  } else {
    sb += "\n\nTidak ada deskripsi yang tersedia bosque";
  }
  sb += "\n\n";

  const isManhwa = item.type.toLowerCase() === "manhwa" || termMap.get("series")?.some((it) => it.toLowerCase() === "manhwa") === true;

  if (!isManhwa) {
    sb += `**Tipe:** ${replaceFirstCharUpper(item.type)}\n`;
    sb += `**Group:** ${orUnknown(termMap.get("group"))}\n`;
    sb += `**Karakter:** ${orUnknown(termMap.get("character"))}\n`;
  }
  const series = termMap.get("series");
  if (series) sb += `**Seri:** ${series.join(", ")}\n`;
  const alt = item.alt_titles;
  if (alt && alt.trim()) {
    const formattedAlts = alt
      .split(/[|,]/)
      .map((it) => it.trim())
      .filter((it) => it)
      .join(", ");

    sb += `**Judul Alternatif:** ${formattedAlts}`;
  }

  manga.description = sb.trim();

  manga.genre = termMap
    .get("genre")
    ?.slice()
    .sort((a, b) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .map(toTitleCase)
    .join(", ");
  return manga;
}

export interface Chapter {
  id: string;
  chapter_number: number;
  created_at: string;
  title?: string | null;
}

/** Float.toString().removeSuffix(".0") */
const format = (n: number) => String(n);

export function chapterToSChapter(c: Chapter, isLast = false): SChapter {
  const chapter = SChapter.create();
  chapter.url = c.id;
  chapter.name = `Chapter ${format(c.chapter_number)}${isLast ? " END" : ""}`;
  chapter.chapter_number = c.chapter_number;
  chapter.date_upload = tryParseInstant(c.created_at);
  return chapter;
}

export interface PageList {
  content_urls: string[];
  manga_slug?: string | null;
}

export const pagesOf = (p: PageList): string[] =>
  p.content_urls.map((page) => {
    if (page.includes("/uploads/") && !page.includes("/storage/uploads/")) return page.replaceAll("/uploads/", "/storage/uploads/");
    if (page.includes("/upload/") && !page.includes("/storage/upload/")) return page.replaceAll("/upload/", "/storage/upload/");
    return page;
  });
