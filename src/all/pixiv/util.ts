// Port of keiyoushi/extensions-source src/all/pixiv/Util.kt

/** countUp(start): start..Int.MAX_VALUE, throwing on overflow. */
export function* countUp(start = 0): Generator<number> {
  for (let i = start; i <= 2147483647; i++) yield i;
  throw new Error("Overflow");
}

/**
 * Lazily fetches pages through [fetchPage] (which returns null once there are no more pages)
 * and hands out results in chunks of arbitrary size.
 */
export class PagedBuffer<T> {
  private nextPage = 1;
  private exhausted = false;
  private buffer: T[] = [];

  constructor(private readonly fetchPage: (page: number) => Promise<T[] | null>) {}

  async take(count: number): Promise<T[]> {
    while (this.buffer.length < count && !this.exhausted) {
      const items = await this.fetchPage(this.nextPage++);
      if (items === null) this.exhausted = true;
      else this.buffer.push(...items);
    }
    return this.buffer.splice(0, Math.min(count, this.buffer.length));
  }
}

/** lruCached(capacity, compute): android.util.LruCache in front of a nullable compute. */
export function lruCached<K, V>(capacity: number, compute: (key: K) => Promise<V | null>): (key: K) => Promise<V | null> {
  const cache = new Map<K, V>();
  return async (key) => {
    const hit = cache.get(key);
    if (hit !== undefined) {
      cache.delete(key); // LruCache.get refreshes recency
      cache.set(key, hit);
      return hit;
    }
    const value = await compute(key);
    if (value !== null) {
      cache.set(key, value);
      if (cache.size > capacity) cache.delete(cache.keys().next().value as K);
    }
    return value;
  };
}
