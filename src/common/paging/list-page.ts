/**
 * Server paging for admin list screens. An endpoint keeps its plain array
 * when the caller sends no `page` (editors and learner screens that need the
 * full list); with `page` it answers one page plus the counts its header
 * shows. No I/O here, so the rules are unit-tested.
 */

export type ListQuery = Record<string, string | undefined>;

export type ListPage<T, F = Record<string, unknown>> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  facets: F;
};

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

/** Paged mode is opt-in: only a request that names a page gets one. */
export const wantsPage = (query: ListQuery) =>
  query.page !== undefined && query.page !== '';

export function clampPageSize(raw?: string, fallback = DEFAULT_PAGE_SIZE) {
  const size = Math.floor(Number(raw));
  return Number.isFinite(size) && size > 0
    ? Math.min(MAX_PAGE_SIZE, size)
    : fallback;
}

/**
 * One page of already filtered and sorted rows. A page past the end shows
 * the last page, so deleting the only row of the last page never leaves an
 * empty screen.
 */
export function pageOf<T>(
  rows: T[],
  query: ListQuery,
  fallbackSize = DEFAULT_PAGE_SIZE,
): Omit<ListPage<T>, 'facets'> {
  const pageSize = clampPageSize(query.pageSize, fallbackSize);
  const lastPage = Math.max(1, Math.ceil(rows.length / pageSize));
  const asked = Math.floor(Number(query.page));
  const page = Math.min(
    lastPage,
    Number.isFinite(asked) && asked > 0 ? asked : 1,
  );
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}

/** Case-insensitive "contains" over several fields, for list search boxes. */
export function matchesSearch(
  q: string | undefined,
  ...fields: Array<string | null | undefined>
) {
  const needle = (q ?? '').trim().toLocaleLowerCase('vi');
  if (!needle) return true;
  return fields
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('vi')
    .includes(needle);
}

/** A filter value that means "no filter". */
export const isAll = (value?: string) => !value || value === 'ALL';
