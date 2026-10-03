// Kotlin stdlib helpers ports use constantly, with Kotlin's semantics: a missing delimiter returns
// `missingDelimiterValue`, which defaults to the whole string.

export const substringAfter = (s: string, d: string, missing = s) => {
  const i = s.indexOf(d);
  return i < 0 ? missing : s.slice(i + d.length);
};
export const substringBefore = (s: string, d: string, missing = s) => {
  const i = s.indexOf(d);
  return i < 0 ? missing : s.slice(0, i);
};
export const substringAfterLast = (s: string, d: string, missing = s) => {
  const i = s.lastIndexOf(d);
  return i < 0 ? missing : s.slice(i + d.length);
};
export const substringBeforeLast = (s: string, d: string, missing = s) => {
  const i = s.lastIndexOf(d);
  return i < 0 ? missing : s.slice(0, i);
};
/** isBlank(): null, empty or whitespace only. */
export const isBlank = (s: string | null | undefined): s is null | undefined | "" => !s || !s.trim();
export const isNotBlank = (s: string | null | undefined): s is string => !isBlank(s);
/** s.ifBlank { fallback }, commonly `ifBlank { null }` -> ifBlank(s, undefined). */
export const ifBlank = <T>(s: string | null | undefined, fallback: T): string | T => (isBlank(s) ? fallback : s);
/** takeIf(String::isNotBlank) */
export const notBlank = (s: string | null | undefined): string | undefined => (isBlank(s) ? undefined : s);
/** String.all(Char::isDigit) - true for "", as in Kotlin. */
export const allDigits = (s: string) => /^\d*$/.test(s);
export const trimEnd = (s: string, c: string) => {
  let i = s.length;
  while (i > 0 && s[i - 1] === c) i--;
  return s.slice(0, i);
};
export const trimStart = (s: string, c: string) => {
  let i = 0;
  while (i < s.length && s[i] === c) i++;
  return s.slice(i);
};
export function distinctBy<T, K>(items: T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  return items.filter((it) => {
    const k = key(it);
    return !seen.has(k) && (seen.add(k), true);
  });
}
/** Regex.escape */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The path of an absolute URL (HttpUrl.encodedPath). */
export const pathOf = (url: string) => new URL(url).pathname;
