// Port of keiyoushi/extensions-source lib-multisrc/natsuid/Dto.kt
import { SManga, type Document } from "../../sdk/index.ts";

export interface Term {
  name: string;
  slug: string;
  taxonomy: string;
}

export interface Manga {
  id: number;
  slug: string;
  title: Rendered;
  content: Rendered;
  meta?: MangaMeta | null;
  metadata?: MangaMeta | null; // @JsonNames("metadata") on `meta`
  _embedded: Embedded;
}

/** Jsoup helpers the DTO conversions need: Parser.unescapeEntities and Jsoup.parseBodyFragment. */
export interface HtmlTools {
  unescapeEntities(s: string): string;
  parseBodyFragment(html: string): Document;
}

export const mangaIsNovel = (m: Manga) => getTerms(m._embedded, "type").includes("Novel");

export function mangaToSManga(m: Manga, html: HtmlTools): SManga {
  const manga = SManga.create();
  manga.url = JSON.stringify({ id: m.id, slug: m.slug } satisfies MangaUrl);
  manga.title = html.unescapeEntities(m.title.rendered);
  const mainDescription = html.parseBodyFragment(m.content.rendered).wholeText().trim();
  // The alternative_title field is comma-separated on the site
  const altTitles = [
    ...new Set(
      ((m.meta ?? m.metadata)?.meta?.alternative_title?.split(",") ?? [])
        .map((it) => html.unescapeEntities(it.trim()))
        .filter((it) => it.trim() && it.toLowerCase() !== manga.title.toLowerCase()),
    ),
  ];

  let description = mainDescription;
  if (altTitles.length) {
    if (description) description += "\n\n";
    description += "Alternative Names:\n";
    description += altTitles.map((it) => `- ${it}`).join("\n");
  }
  manga.description = description.trim();
  manga.thumbnail_url = m._embedded["wp:featuredmedia"]?.[0]?.source_url;
  manga.author = getTerms(m._embedded, "series-author").join(", ");
  manga.artist = getTerms(m._embedded, "artist").join(", ");
  manga.genre = [...new Set([...getTerms(m._embedded, "genre"), ...getTerms(m._embedded, "type")])].join(", ");
  const status = getTerms(m._embedded, "status");
  manga.status = status.includes("Ongoing")
    ? SManga.ONGOING
    : status.includes("Completed")
      ? SManga.COMPLETED
      : status.includes("Cancelled")
        ? SManga.CANCELLED
        : status.includes("On Hiatus")
          ? SManga.ON_HIATUS
          : SManga.UNKNOWN;
  manga.memo = { id: m.id };
  manga.initialized = true;
  return manga;
}

export interface MangaMeta {
  meta?: InnerMeta | null;
}

export interface InnerMeta {
  alternative_title?: string | null;
}

export interface Embedded {
  "wp:featuredmedia"?: FeaturedMedia[] | null;
  "wp:term": Term[][];
}

/** Embedded.getTerms(type) */
export function getTerms(e: Embedded, type: string): string[] {
  return e["wp:term"].find((it) => it[0]?.taxonomy === type)?.map((it) => it.name) ?? [];
}

export interface FeaturedMedia {
  source_url: string;
}

export interface Rendered {
  rendered: string;
}

export interface MangaUrl {
  id: number;
  slug: string;
}
