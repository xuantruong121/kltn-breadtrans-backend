import { deckListFacets, filterDeckList } from './vocab-deck-list';
import { AdminService } from './admin.service';

const deck = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Deck ${id}`,
  categoryName: 'TOEIC',
  publicationStatus: 'DRAFT',
  _count: { words: 10 },
  ...extra,
});

describe('vocab deck list rules', () => {
  const decks = [
    deck(1, { title: 'Office', level: 'B1', publicationStatus: 'PUBLISHED' }),
    deck(2, {
      title: 'Airport',
      level: 'A2',
      categoryName: 'Travel',
      _count: { words: 4 },
    }),
    deck(3, { title: 'Bank', description: 'tài chính' }),
  ];

  it('filters by search, category, level (NONE = unset) and status', () => {
    const ids = (q: Record<string, string>) =>
      filterDeckList(decks, q).map((d) => d.id);
    expect(ids({})).toEqual([3, 2, 1]);
    expect(ids({ q: 'TÀI' })).toEqual([3]);
    expect(ids({ category: 'Travel' })).toEqual([2]);
    expect(ids({ level: 'NONE' })).toEqual([3]);
    expect(ids({ status: 'PUBLISHED' })).toEqual([1]);
    expect(ids({ sort: 'LEVEL' })).toEqual([2, 1, 3]);
    expect(ids({ sort: 'FEWEST' })).toEqual([2, 3, 1]);
    expect(ids({ sort: 'TITLE' })).toEqual([2, 3, 1]);
  });

  it('counts every deck for the header', () => {
    expect(deckListFacets(decks)).toEqual({
      total: 3,
      published: 1,
      categories: ['TOEIC', 'Travel'],
    });
  });

  it('keeps the plain array without a page, pages with one', async () => {
    const prisma = {
      vocabTopic: { findMany: jest.fn().mockResolvedValue(decks) },
    };
    const service = new AdminService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
    );
    expect(await service.getVocabTopics()).toBe(decks);
    const page = (await service.getVocabTopics({
      page: '2',
      pageSize: '2',
    })) as any;
    expect(page.items.map((d: any) => d.id)).toEqual([1]);
    expect(page.total).toBe(3);
    expect(page.facets.published).toBe(1);
  });
});
