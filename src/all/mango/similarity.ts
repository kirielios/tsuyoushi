// The two algorithms of info.debatty:java-string-similarity 2.0.0 that Mango uses (Levenshtein, JaroWinkler).

/** Levenshtein.distance: the plain edit distance. */
export function levenshteinDistance(s1: string, s2: string): number {
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;
  let v0 = Array.from({ length: s2.length + 1 }, (_, i) => i);
  let v1 = new Array<number>(s2.length + 1).fill(0);
  for (let i = 0; i < s1.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < s2.length; j++) {
      const cost = s1[i] === s2[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    [v0, v1] = [v1, v0];
  }
  return v0[s2.length];
}

function matches(s1: string, s2: string): [number, number, number, number] {
  const [max, min] = s1.length > s2.length ? [s1, s2] : [s2, s1];
  const range = Math.max(Math.trunc(max.length / 2) - 1, 0);
  const matchIndexes = new Array<number>(min.length).fill(-1);
  const matchFlags = new Array<boolean>(max.length).fill(false);
  let count = 0;
  for (let mi = 0; mi < min.length; mi++) {
    const c1 = min[mi];
    for (let xi = Math.max(mi - range, 0), xn = Math.min(mi + range + 1, max.length); xi < xn; xi++) {
      if (!matchFlags[xi] && c1 === max[xi]) {
        matchIndexes[mi] = xi;
        matchFlags[xi] = true;
        count++;
        break;
      }
    }
  }
  const ms1: string[] = [];
  const ms2: string[] = [];
  for (let i = 0; i < min.length; i++) if (matchIndexes[i] !== -1) ms1.push(min[i]);
  for (let i = 0; i < max.length; i++) if (matchFlags[i]) ms2.push(max[i]);
  let transpositions = 0;
  for (let i = 0; i < ms1.length; i++) if (ms1[i] !== ms2[i]) transpositions++;
  let prefix = 0;
  for (let mi = 0; mi < min.length; mi++) {
    if (s1[mi] === s2[mi]) prefix++;
    else break;
  }
  return [count, Math.trunc(transpositions / 2), prefix, max.length];
}

/** JaroWinkler.distance = 1 - similarity (threshold 0.7, scaling 0.1). */
export function jaroWinklerDistance(s1: string, s2: string): number {
  if (s1 === s2) return 0;
  const [m, t, prefix, maxLen] = matches(s1, s2);
  if (m === 0) return 1;
  const j = (m / s1.length + m / s2.length + (m - t) / m) / 3;
  const jw = j > 0.7 ? j + Math.min(0.1, 1.0 / maxLen) * prefix * (1 - j) : j;
  return 1 - jw;
}
