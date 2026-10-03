// Port of keiyoushi/extensions-source lib-multisrc/galleryadults/GalleryAdultsUtils.kt
import { substringAfterLast, substringBefore, type DateTimeFormatter, type Element } from "../../sdk/index.ts";

// any space except after a comma (we're going to replace spaces only between words)
export const regexSpaceNotAfterComma = /(?<!,)\s+/g;

// extract preceding minus (-) and term
export const regexExcludeTerm = /^(-?)"?(.+)"?/;

const regexDateSuffix = /\d(st|nd|rd|th)/;
const regexDate = /\d\D\D/;
const regexNotNumber = /\D/g;
const regexRelativeDateTime = /\d*[^0-9]*(\d+)/;

export function imgAttr(el: Element): string {
  if (el.hasAttr("data-cfsrc")) return el.absUrl("data-cfsrc");
  if (el.hasAttr("data-src")) return el.absUrl("data-src");
  if (el.hasAttr("data-lazy-src")) return el.absUrl("data-lazy-src");
  if (el.hasAttr("srcset")) return substringBefore(el.absUrl("srcset"), " ");
  return el.absUrl("src");
}

// convert thumbnail URLs to full image URLs
export function thumbnailToFull(s: string): string {
  const ext = substringAfterLast(s, ".");
  return s.replaceAll(`t.${ext}`, `.${ext}`);
}

export function toDate(s: string | null | undefined, formatter: DateTimeFormatter | null): number {
  if (s == null) return 0;
  if (formatter != null) {
    if (regexDateSuffix.test(s)) {
      // Clean date (e.g. 5th December 2019 to 5 December 2019) before parsing it
      const cleaned = s
        .split(" ")
        .map((it) => (regexDate.test(it) ? it.replace(regexNotNumber, "") : it))
        .join(" ");
      return formatter.tryParseDate(cleaned);
    }
    return formatter.tryParseDate(s);
  }
  return parseDate(s);
}

/** kotlin.time.Instant.parseOrNull: ISO-8601 with a UTC offset. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/i;

// Calendar.getInstance(): local time, as upstream
const midnight = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function parseDate(date: string): number {
  if (ISO_INSTANT.test(date)) {
    const parsed = Date.parse(date);
    if (!Number.isNaN(parsed) && parsed !== 0) return parsed;
  }
  // Handle 'yesterday' and 'today', using midnight
  if (new WordSet("yesterday", "يوم واحد").startsWith(date)) return midnight(1);
  if (new WordSet("today", "just now").startsWith(date)) return midnight(0);
  if (new WordSet("يومين").startsWith(date)) return midnight(2); // day before yesterday
  if (new WordSet("ago", "atrás", "önce", "قبل").endsWith(date)) return parseRelativeDate(date);
  if (new WordSet("hace").startsWith(date)) return parseRelativeDate(date);
  return 0;
}

const toIntOrNull = (s: string | undefined) => (s != null && /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null);

// Parses dates in this form: 21 hours ago OR "2 days ago (Updated 19 hours ago)"
function parseRelativeDate(date: string): number {
  const number =
    toIntOrNull(regexRelativeDateTime.exec(date)?.[0]) ??
    toIntOrNull(date.split(" ")[0]?.replaceAll("one", "1").replaceAll("a", "1"));
  if (number == null) return 0;
  const now = new Date();

  // Sort by order
  if (new WordSet("detik", "segundo", "second", "วินาที").anyWordIn(date)) now.setSeconds(now.getSeconds() - number);
  else if (new WordSet("menit", "dakika", "min", "minute", "minuto", "นาที", "دقائق").anyWordIn(date)) now.setMinutes(now.getMinutes() - number);
  else if (new WordSet("jam", "saat", "heure", "hora", "hour", "ชั่วโมง", "giờ", "ore", "ساعة", "小时").anyWordIn(date)) now.setHours(now.getHours() - number);
  else if (new WordSet("hari", "gün", "jour", "día", "dia", "day", "วัน", "ngày", "giorni", "أيام", "天").anyWordIn(date)) now.setDate(now.getDate() - number);
  else if (new WordSet("week", "semana").anyWordIn(date)) now.setDate(now.getDate() - number * 7);
  else if (new WordSet("month", "mes").anyWordIn(date)) now.setMonth(now.getMonth() - number);
  else if (new WordSet("year", "año").anyWordIn(date)) now.setFullYear(now.getFullYear() - number);
  else return 0;
  return now.getTime();
}

export class WordSet {
  private readonly words: string[];
  constructor(...words: string[]) {
    this.words = words.map((w) => w.toLowerCase());
  }
  anyWordIn(dateString: string) {
    return this.words.some((w) => dateString.toLowerCase().includes(w));
  }
  startsWith(dateString: string) {
    return this.words.some((w) => dateString.toLowerCase().startsWith(w));
  }
  endsWith(dateString: string) {
    return this.words.some((w) => dateString.toLowerCase().endsWith(w));
  }
}

export const toBinary = (boolean: boolean) => (boolean ? "1" : "0");
