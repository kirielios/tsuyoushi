// The slice of java.time that sources use to read dates: DateTimeFormatter.ofPattern / DateTimeFormatterBuilder with
// keiyoushi's tryParseDate / tryParseDateTime / tryParseZonedDateTime. Month and weekday names come from the runtime's
// ICU data (globalThis.Intl), so any locale a source names works without tables.
//
// Deliberately lenient where java.time is strict: text is matched case-insensitively and MM/dd accept one digit, so a
// date java.time would reject for "jan" vs "Jan" still parses. Unparseable input returns 0, as upstream.

export class Locale {
  readonly tag: string;
  constructor(language: string, country?: string) {
    this.tag = country ? `${language}-${country}` : language;
  }
  static forLanguageTag(tag: string) {
    return new Locale(tag || "en");
  }
  static readonly US = new Locale("en", "US");
  static readonly ENGLISH = new Locale("en");
  static readonly UK = new Locale("en", "GB");
  static readonly ROOT = new Locale("en"); // Java's ROOT locale prints English names
  static readonly FRENCH = new Locale("fr");
  static readonly GERMAN = new Locale("de");
  static readonly JAPANESE = new Locale("ja");
  static getDefault() {
    return Locale.US;
  }
}

/** A zone: "UTC", a fixed offset in minutes, or an IANA id. Undefined means the system zone, as ZoneId.systemDefault(). */
export type Zone = string | undefined;
export const ZoneOffset = { UTC: "UTC" as Zone, ofHours: (h: number): Zone => `${h >= 0 ? "+" : "-"}${String(Math.abs(h)).padStart(2, "0")}:00` };
export const ZoneId = { of: (id: string): Zone => id, systemDefault: (): Zone => undefined };

const cache = new Map<string, string[]>();
function names(tag: string, kind: "month" | "weekday", style: "long" | "short"): string[] {
  const key = `${tag}|${kind}|${style}`;
  let out = cache.get(key);
  if (!out) {
    const set = new Set<string>();
    const count = kind === "month" ? 12 : 7;
    for (let i = 0; i < count; i++) {
      const date = kind === "month" ? new Date(Date.UTC(2021, i, 15)) : new Date(Date.UTC(2021, 1, 1 + i)); // 2021-02-01 is a Monday
      // standalone ("januar") and in-date ("januara") forms differ in some languages; accept both
      const alone = new globalThis.Intl.DateTimeFormat(tag, { [kind]: style, timeZone: "UTC" }).format(date);
      const inDate = new globalThis.Intl.DateTimeFormat(tag, kind === "month" ? { day: "numeric", month: style, timeZone: "UTC" } : { weekday: style, day: "numeric", timeZone: "UTC" })
        .formatToParts(date)
        .find((p) => p.type === kind)?.value;
      for (const n of [alone, inDate]) if (n) set.add(`${i}\u0000${n.replace(/\.$/, "")}`);
    }
    out = [...set];
    cache.set(key, out);
  }
  return out;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Fields = { year?: number; month?: number; day?: number; hour?: number; minute?: number; second?: number; ms?: number; pm?: boolean; offset?: number | string };

export class DateTimeFormatter {
  private readonly regex: RegExp;
  private readonly slots: ((value: string, f: Fields) => void)[] = [];

  private constructor(
    readonly pattern: string,
    readonly locale: Locale,
    readonly zone: Zone = undefined,
  ) {
    let src = "";
    const optionalStarts: number[] = [];
    const add = (re: string, set?: (value: string, f: Fields) => void) => {
      src += set ? `(${re})` : re;
      if (set) this.slots.push(set);
    };
    const nameAlt = (kind: "month" | "weekday", style: "long" | "short") => {
      const list = names(locale.tag, kind, style).map((e) => e.split("\u0000"));
      // Either width accepts both forms and any 3+ letter prefix of the full name: sites write "Agu 17, 2021" under a
      // declared "MMMM" and "Sept" where ICU says "Sep". java.time rejects both, so upstream leaves those undated.
      const other = names(locale.tag, kind, style === "short" ? "long" : "short").map((e) => e.split("\u0000"));
      list.push(...other);
      for (const [i, full] of style === "long" ? list.slice() : other)
        for (let k = 3; k < full.length; k++) list.push([i, full.slice(0, k)]);
      list.sort((a, b) => b[1].length - a[1].length);
      return { re: list.map(([, n]) => `${esc(n)}\\.?`).join("|"), index: (v: string) => Number(list.find(([, n]) => v.replace(/\.$/, "").toLowerCase() === n.toLowerCase())?.[0] ?? NaN) };
    };
    for (let i = 0; i < pattern.length; ) {
      const c = pattern[i];
      if (c === "'") {
        const end = pattern.indexOf("'", i + 1);
        const lit = end === i + 1 ? "'" : pattern.slice(i + 1, end < 0 ? undefined : end);
        add(esc(lit));
        i = end < 0 ? pattern.length : end + 1;
        continue;
      }
      // optional sections: "[:mm]" -> (?:...)?; a group that did not take part leaves its field unset
      if (c === "[") {
        optionalStarts.push(src.length);
        i++;
        continue;
      }
      if (c === "]" && optionalStarts.length) {
        const start = optionalStarts.pop()!;
        src = `${src.slice(0, start)}(?:${src.slice(start)})?`;
        i++;
        continue;
      }
      if (!/[A-Za-z]/.test(c)) {
        add(c === " " ? "\\s+" : esc(c));
        i++;
        continue;
      }
      let n = 1;
      while (pattern[i + n] === c) n++;
      i += n;
      switch (c) {
        case "y":
        case "u":
          add(n === 2 ? "\\d{2}" : "\\d{4}", (v, f) => (f.year = n === 2 ? 2000 + Number(v) : Number(v)));
          break;
        case "M":
        case "L":
          if (n <= 2) add("\\d{1,2}", (v, f) => (f.month = Number(v) - 1));
          else {
            const alt = nameAlt("month", n === 3 ? "short" : "long");
            add(alt.re, (v, f) => (f.month = alt.index(v)));
          }
          break;
        case "d":
          add("\\d{1,2}", (v, f) => (f.day = Number(v)));
          break;
        case "H":
        case "k":
          add("\\d{1,2}", (v, f) => (f.hour = Number(v) % 24));
          break;
        case "h":
        case "K":
          add("\\d{1,2}", (v, f) => (f.hour = Number(v) % 12));
          break;
        case "m":
          add("\\d{1,2}", (v, f) => (f.minute = Number(v)));
          break;
        case "s":
          add("\\d{1,2}", (v, f) => (f.second = Number(v)));
          break;
        case "S":
          add(`\\d{1,${Math.max(n, 3)}}`, (v, f) => (f.ms = Math.round(Number(`0.${v}`) * 1000)));
          break;
        case "a":
          add("[ap]\\.?\\s?m\\.?", (v, f) => (f.pm = v.toLowerCase().startsWith("p")));
          break;
        case "E": {
          const alt = nameAlt("weekday", n <= 3 ? "short" : "long");
          add(`(?:${alt.re})`);
          break;
        }
        case "X":
        case "x":
        case "Z":
        case "O":
          add("Z|[+-]\\d{2}:?\\d{2}|GMT[+-]\\d{1,2}(?::?\\d{2})?", (v, f) => (f.offset = v));
          break;
        case "z":
        case "V":
          add("[A-Za-z_/]{1,40}", (v, f) => (f.offset = v));
          break;
        default:
          add("\\S+"); // era, day-of-year, week fields: consumed, not interpreted
      }
    }
    this.regex = new RegExp(`^\\s*${src}\\s*$`, "iu");
  }

  static ofPattern(pattern: string, locale: Locale = Locale.getDefault()) {
    return new DateTimeFormatter(pattern, locale);
  }
  withZone(zone: Zone) {
    return new DateTimeFormatter(this.pattern, this.locale, zone);
  }
  withLocale(locale: Locale) {
    return new DateTimeFormatter(this.pattern, locale, this.zone);
  }

  private fields(text: string): Fields | null {
    const m = this.regex.exec(text);
    if (!m) return null;
    const f: Fields = {};
    this.slots.forEach((set, i) => m[i + 1] !== undefined && set(m[i + 1], f));
    if (f.pm !== undefined && f.hour !== undefined) f.hour = (f.hour % 12) + (f.pm ? 12 : 0);
    if (f.year === undefined || f.month === undefined || Number.isNaN(f.month) || f.day === undefined) return null;
    // reject 31 February and friends, as java.time's resolver does
    const probe = new Date(Date.UTC(f.year, f.month, f.day));
    if (probe.getUTCMonth() !== f.month || probe.getUTCDate() !== f.day) return null;
    return f;
  }

  /** keiyoushi's DateTimeFormatter.tryParseDate: start of that day in `zone`, 0 when it does not parse. */
  tryParseDate(date: string | null | undefined, zone?: Zone): number {
    const f = date == null ? null : this.fields(date);
    return f ? atZone(Date.UTC(f.year!, f.month!, f.day!), zone ?? this.zone) : 0;
  }
  /** Local date and time resolved in `zone`; any offset in the text is ignored, as upstream. */
  tryParseDateTime(date: string | null | undefined, zone?: Zone): number {
    const f = date == null ? null : this.fields(date);
    return f ? atZone(Date.UTC(f.year!, f.month!, f.day!, f.hour ?? 0, f.minute ?? 0, f.second ?? 0, f.ms ?? 0), zone ?? this.zone) : 0;
  }
  /** The text's own offset decides the instant; 0 when the pattern produced none. */
  tryParseZonedDateTime(date: string | null | undefined): number {
    const f = date == null ? null : this.fields(date);
    if (!f || f.offset === undefined) return 0;
    const local = Date.UTC(f.year!, f.month!, f.day!, f.hour ?? 0, f.minute ?? 0, f.second ?? 0, f.ms ?? 0);
    return atZone(local, typeof f.offset === "string" ? f.offset : undefined);
  }
}

/** Kotlin's DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern(p).toFormatter(locale). Text is always case-insensitive here. */
export class DateTimeFormatterBuilder {
  private pattern = "";
  parseCaseInsensitive() {
    return this;
  }
  parseLenient() {
    return this;
  }
  appendPattern(p: string) {
    this.pattern += p;
    return this;
  }
  toFormatter(locale: Locale = Locale.getDefault()) {
    return DateTimeFormatter.ofPattern(this.pattern, locale);
  }
}

/** Interpret a wall-clock time (encoded as if UTC) in `zone` and return the real instant. */
export function atZone(localAsUtc: number, zone: Zone): number {
  if (zone === "UTC" || zone === "Z") return localAsUtc;
  const fixed = zone && /^(?:GMT)?([+-])(\d{1,2}):?(\d{2})?$/.exec(zone);
  if (fixed) return localAsUtc - (fixed[1] === "-" ? -1 : 1) * (Number(fixed[2]) * 60 + Number(fixed[3] ?? 0)) * 60_000;
  if (!zone) {
    const d = new Date(localAsUtc);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()).getTime();
  }
  // IANA zone: find its offset at that moment (two passes settle a DST edge)
  let guess = localAsUtc;
  for (let i = 0; i < 2; i++) guess = localAsUtc - offsetOf(zone, guess);
  return guess;
}
function offsetOf(zone: string, instant: number): number {
  try {
    const parts = new globalThis.Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(instant));
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - Math.floor(instant / 1000) * 1000;
  } catch {
    return 0; // unknown zone: treat as UTC rather than throw
  }
}

/** Start of today in UTC, minus `days` (Kotlin's LocalDate.now(UTC).minusDays(n).atStartOfDay(UTC)). */
export function startOfDayUtc(daysAgo = 0): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo);
}
/** ZonedDateTime.now(UTC).minus(amount, unit) */
export function ago(amount: number, unit: "years" | "months" | "weeks" | "days" | "hours" | "minutes" | "seconds"): number {
  const d = new Date();
  switch (unit) {
    case "years":
      d.setUTCFullYear(d.getUTCFullYear() - amount);
      break;
    case "months":
      d.setUTCMonth(d.getUTCMonth() - amount);
      break;
    case "weeks":
      d.setUTCDate(d.getUTCDate() - amount * 7);
      break;
    case "days":
      d.setUTCDate(d.getUTCDate() - amount);
      break;
    default:
      d.setTime(d.getTime() - amount * { hours: 3_600_000, minutes: 60_000, seconds: 1000 }[unit]);
  }
  return d.getTime();
}

/** keiyoushi's Instant.tryParse (kotlin.time.Instant.parseOrNull): an ISO-8601 instant with Z, ±hh or ±hh:mm, else 0. */
export function tryParseInstant(date: string | null | undefined): number {
  if (!date || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:\d{2})?)$/i.test(date)) return 0;
  // kotlin accepts a bare "+00" offset (Postgres timestamps); Date.parse needs "+00:00"
  const t = Date.parse(/[+-]\d{2}$/.test(date) ? `${date}:00` : date);
  return Number.isNaN(t) ? 0 : t;
}
