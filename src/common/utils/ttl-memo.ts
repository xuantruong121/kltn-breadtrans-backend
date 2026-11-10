/**
 * A small in-process cache for content that rarely changes (a quiz's type,
 * tier, title, CEFR tag), read on almost every learner request. Entries live
 * `ttlMs`; at most `max` are kept, the oldest dropped first. Concurrent misses
 * for one key share a single load. Values are per process: an edit is seen by
 * every process within `ttlMs` (capacity run 2026-11-09).
 */
export class TtlMemo<K, V> {
  private readonly entries = new Map<K, { at: number; value: Promise<V> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 5_000,
  ) {}

  get(key: K, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at <= this.ttlMs) return hit.value;
    const value = load();
    this.entries.delete(key);
    if (this.entries.size >= this.max)
      this.entries.delete(this.entries.keys().next().value as K);
    this.entries.set(key, { at: Date.now(), value });
    // A failed load is not remembered.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  /** The fresh value for `key`, without loading it. */
  peek(key: K): Promise<V> | undefined {
    const hit = this.entries.get(key);
    return hit && Date.now() - hit.at <= this.ttlMs ? hit.value : undefined;
  }

  /** Stores a value loaded elsewhere (a batch query). */
  set(key: K, value: V) {
    this.entries.delete(key);
    if (this.entries.size >= this.max)
      this.entries.delete(this.entries.keys().next().value as K);
    this.entries.set(key, { at: Date.now(), value: Promise.resolve(value) });
  }

  delete(key: K) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}
