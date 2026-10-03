// Port of keiyoushi/extensions-source src/all/projectsuki/SmartBookSearchHandler.kt
//
// Android ICU maps onto the JS platform: BreakIterator -> Intl.Segmenter (word / grapheme), Normalizer2 NFKC_Casefold
// -> normalize("NFKC") + toLowerCase, and the PRIMARY-strength StringSearch (ignores case and accents, overlapping)
// -> an overlapping indexOf over accent-stripped text.
import type { MangasPage } from "../../../sdk/index.ts";
import { toMangasPage } from "./api.ts";
import type { BookID, BookTitle } from "./pathpattern.ts";

const wordBreak = new Intl.Segmenter(undefined, { granularity: "word" });
const charBreak = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const normalize = (s: string) => s.normalize("NFKC").toLowerCase();
/** Collator.PRIMARY: base letters only */
const primary = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const graphemes = (s: string) => [...charBreak.segment(s)].map((it) => it.segment);

const fib32 = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946, 17711, 28657, 46368, 75025, 121393, 196418, 317811, 514229, 832040, 1346269, 2178309];
const SCORE_EXTRA = 1;
const NEEDED_FRACTIONAL_SCORE_FOR_INCLUSION = 0.5;
const MINIMUM_RESULTS = 8;

/** StringSearch with isOverlapping = true: every match start, with the matched text. */
function* search(target: string, pattern: string): Generator<string> {
  const t = primary(target);
  const p = primary(pattern);
  if (!p) return;
  for (let idx = t.indexOf(p); idx >= 0; idx = t.indexOf(p, idx + 1)) yield t.slice(idx, idx + p.length);
}

export class SmartBookSearchHandler {
  constructor(
    readonly rawQuery: string,
    readonly rawBooksData: Map<BookID, BookTitle>,
  ) {}

  get wordsData(): { words: string[]; extra: string[] } {
    const words = [...wordBreak.segment(normalize(this.rawQuery))];
    const extra: string[] = [];
    for (const it of words) if (!it.isWordLike) extra.push(...graphemes(it.segment));
    return { words: words.filter((it) => it.isWordLike).map((it) => it.segment), extra };
  }

  wordScoreFor(matchedText: string): number {
    return fib32[graphemes(matchedText).length] ?? fib32[fib32.length - 1];
  }

  get filteredBooks(): BookID[] {
    const wordsData = this.wordsData;
    const scored = new Map<BookID, number>();

    for (const [bookID, title] of this.rawBooksData) {
      const normTitle = normalize(title);
      let score = 0;
      for (const word of wordsData.words) for (const matched of search(normTitle, word)) score += this.wordScoreFor(matched);
      for (const extra of wordsData.extra) for (const _ of search(normTitle, extra)) score += SCORE_EXTRA;
      scored.set(bookID, score);
    }

    const byScore = new Map<number, BookID[]>();
    for (const [id, score] of scored) byScore.set(score, [...(byScore.get(score) ?? []), id]);
    const sorted = [...byScore].sort((a, b) => b[0] - a[0]);
    if (!sorted.length) throw new Error("NoSuchElementException"); // TreeMap.firstKey() on an empty map
    const highest = sorted[0][0];

    const included: BookID[] = [];
    for (const [score, group] of sorted) {
      const include = score > 0 && (included.length < MINIMUM_RESULTS || score / highest >= NEEDED_FRACTIONAL_SCORE_FOR_INCLUSION);
      if (!include) break;
      included.push(...group);
    }
    return included;
  }

  get mangasPage(): MangasPage {
    return toMangasPage(new Map(this.filteredBooks.map((it) => [it, this.rawBooksData.get(it)!])));
  }
}
