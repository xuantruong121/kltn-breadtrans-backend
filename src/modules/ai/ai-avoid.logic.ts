/**
 * "Tạo câu khác" in the CMS draft reviews (owner 2026-11-25): one new item
 * in place of one the admin does not want, never a repeat of an item the
 * draft already holds. Pure: no I/O.
 */

/** Two items are the same when they differ only in case, spacing or end punctuation. */
export const itemKey = (line: string) =>
  line
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?…,;:'"“”‘’()-]+$/u, '')
    .replace(/^[\s"“‘(-]+/u, '')
    .trim();

/**
 * The items a new one must not repeat: strings only, one line each, no
 * blanks or repeats, at most 40 of 300 characters.
 */
export function aiAvoidList(avoid: unknown): string[] {
  const seen = new Set<string>();
  return (Array.isArray(avoid) ? avoid : [])
    .filter((line): line is string => typeof line === 'string')
    .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, 300))
    .filter((line) => {
      const key = itemKey(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40);
}

/** The prompt line for a list to avoid; empty without one. */
export function avoidRule(
  what: string,
  avoid: string[],
  where = 'the avoid list of the reference data',
): string {
  return avoid.length
    ? `The draft already has the ${what} in ${where}: never repeat or closely reword any of them, and keep the same topic and level. `
    : '';
}

/** The new items minus any that repeat an avoided one. */
export function withoutAvoidedItems<T>(
  items: T[],
  keyOf: (item: T) => string,
  avoid: string[],
): T[] {
  if (!avoid.length) return items;
  const taken = new Set(avoid.map(itemKey));
  return items.filter((item) => !taken.has(itemKey(keyOf(item))));
}
