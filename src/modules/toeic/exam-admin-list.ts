/**
 * Filters, sorts and header counts for the admin exam list, run on the
 * server so the list loads (and presigns audio for) one page only. No I/O.
 */
import { isAll, ListQuery, matchesSearch } from '../../common/paging/list-page';

export type ExamListRow = {
  id: number;
  title: string;
  description?: string | null;
  publicationStatus?: string | null;
  familyCode?: string | null;
  variantCode?: string | null;
  learnerReady?: boolean | null;
  totalQuestions?: number | null;
  updatedAt?: Date | string | null;
};

/** Newest edit first by default; `ready` is READY or NOT_READY. */
export function filterExamList<T extends ExamListRow>(
  rows: T[],
  query: ListQuery,
): T[] {
  const visible = rows.filter(
    (row) =>
      matchesSearch(query.q, row.title, row.description) &&
      (isAll(query.status) || row.publicationStatus === query.status) &&
      (isAll(query.family) || row.familyCode === query.family) &&
      (isAll(query.variant) || row.variantCode === query.variant) &&
      (isAll(query.ready) ||
        (query.ready === 'READY') === Boolean(row.learnerReady)),
  );
  const updated = (row: T) => new Date(row.updatedAt ?? 0).getTime();
  const order: Record<string, (a: T, b: T) => number> = {
    UPDATED: (a, b) => updated(b) - updated(a) || b.id - a.id,
    TITLE: (a, b) => a.title.localeCompare(b.title, 'vi'),
    QUESTIONS: (a, b) =>
      (b.totalQuestions ?? 0) - (a.totalQuestions ?? 0) || b.id - a.id,
  };
  return visible.sort(order[query.sort ?? ''] ?? order.UPDATED);
}

export function examListFacets(rows: ExamListRow[]) {
  return {
    total: rows.length,
    published: rows.filter((row) => row.publicationStatus === 'PUBLISHED')
      .length,
    learnerReady: rows.filter((row) => row.learnerReady).length,
  };
}
