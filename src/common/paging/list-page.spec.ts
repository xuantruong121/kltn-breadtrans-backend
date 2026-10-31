import {
  clampPageSize,
  isAll,
  matchesSearch,
  pageOf,
  wantsPage,
} from './list-page';

describe('list paging', () => {
  const rows = Array.from({ length: 50 }, (_, i) => i + 1);

  it('is opt-in: no page means the caller keeps its full array', () => {
    expect(wantsPage({})).toBe(false);
    expect(wantsPage({ page: '' })).toBe(false);
    expect(wantsPage({ page: '1' })).toBe(true);
  });

  it('slices a page and reports the total', () => {
    expect(pageOf(rows, { page: '2', pageSize: '20' })).toEqual({
      items: rows.slice(20, 40),
      total: 50,
      page: 2,
      pageSize: 20,
    });
  });

  it('shows the last page for a page past the end, and page 1 for junk', () => {
    expect(pageOf(rows, { page: '9', pageSize: '20' }).page).toBe(3);
    expect(pageOf(rows, { page: '-4', pageSize: '20' }).page).toBe(1);
    expect(pageOf([], { page: '3' })).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 24,
    });
  });

  it('caps the page size and falls back on junk', () => {
    expect(clampPageSize('500')).toBe(100);
    expect(clampPageSize('abc')).toBe(24);
    expect(clampPageSize('0', 12)).toBe(12);
  });

  it('searches several fields without case', () => {
    expect(matchesSearch(' họp ', 'Cuộc HỌP sáng', null)).toBe(true);
    expect(matchesSearch('agenda', 'meeting', undefined)).toBe(false);
    expect(matchesSearch('', 'anything')).toBe(true);
  });

  it('treats an empty or ALL filter as no filter', () => {
    expect(isAll(undefined)).toBe(true);
    expect(isAll('ALL')).toBe(true);
    expect(isAll('DRAFT')).toBe(false);
  });
});
