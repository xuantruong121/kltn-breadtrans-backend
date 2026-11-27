/**
 * Filters, sorts and header counts for the admin vocab deck list, run on
 * the server so the list loads one page. No I/O.
 */
import { isAll, ListQuery, matchesSearch } from '../../common/paging/list-page';
import { PRACTICE_LEVELS } from '../subscription/practice-level';

/** A deck's level is one of the four practice levels (owner 2026-11-27). */
const DECK_LEVELS: readonly string[] = PRACTICE_LEVELS;

export type DeckListRow = {
  id: number;
  title: string;
  description?: string | null;
  categoryName: string;
  level?: string | null;
  publicationStatus: string;
  totalWords?: number | null;
  _count?: { words?: number };
};

const wordCount = (row: DeckListRow) =>
  row._count?.words ?? row.totalWords ?? 0;

const levelRank = (row: DeckListRow) => {
  const index = DECK_LEVELS.indexOf(row.level ?? '');
  return index < 0 ? 99 : index;
};

/**
 * `level=NONE` keeps decks without a level. Newest (highest id) first;
 * OLDEST reverses it.
 */
export function filterDeckList<T extends DeckListRow>(
  rows: T[],
  query: ListQuery,
): T[] {
  const visible = rows.filter(
    (row) =>
      matchesSearch(query.q, row.title, row.description, row.categoryName) &&
      (isAll(query.category) || row.categoryName === query.category) &&
      (isAll(query.level) ||
        (row.level ?? '') === (query.level === 'NONE' ? '' : query.level)) &&
      (isAll(query.status) || row.publicationStatus === query.status),
  );
  const order: Record<string, (a: T, b: T) => number> = {
    NEWEST: (a, b) => b.id - a.id,
    OLDEST: (a, b) => a.id - b.id,
    TITLE: (a, b) => a.title.localeCompare(b.title, 'vi'),
    LEVEL: (a, b) => levelRank(a) - levelRank(b) || b.id - a.id,
    FEWEST: (a, b) => wordCount(a) - wordCount(b) || b.id - a.id,
  };
  return visible.sort(order[query.sort ?? ''] ?? order.NEWEST);
}

export function deckListFacets(rows: DeckListRow[]) {
  return {
    total: rows.length,
    published: rows.filter((row) => row.publicationStatus === 'PUBLISHED')
      .length,
    categories: [...new Set(rows.map((row) => row.categoryName))].sort(),
  };
}
