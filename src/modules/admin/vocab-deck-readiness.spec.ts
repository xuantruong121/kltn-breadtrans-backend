import { AdminService } from './admin.service';
import {
  deckStatsFromEntries,
  vocabDeckProblems,
} from './vocab-deck-readiness';

const entry = (meaningVi: string, extra: Record<string, string> = {}) => ({
  meaningVi,
  ipaUs: '/x/',
  exampleEn: 'An example.',
  ...extra,
});

describe('vocab deck readiness: the editor checklist on the server', () => {
  it('counts as the deck summary does: null or empty is missing', () => {
    expect(
      deckStatsFromEntries([
        entry('hợp đồng'),
        entry(' hợp đồng ', { ipaUs: '' }),
        { meaningVi: 'hoá đơn', ipaUs: null, exampleEn: null },
      ]),
    ).toEqual({ total: 3, withIpa: 1, withExample: 2, distinctMeanings: 2 });
  });

  it('an empty deck needs a title and a word, nothing more', () => {
    expect(
      vocabDeckProblems({
        title: '',
        stats: { total: 0, withIpa: 0, withExample: 0, distinctMeanings: 0 },
      }),
    ).toEqual(['có tên bộ từ', 'có ít nhất 1 từ']);
  });

  it('names each missing item with its counts', () => {
    expect(
      vocabDeckProblems({
        title: 'Họp',
        stats: { total: 3, withIpa: 1, withExample: 2, distinctMeanings: 3 },
      }),
    ).toEqual([
      'phiên âm 1/3 từ',
      'câu ví dụ 2/3 từ',
      'ít nhất 4 nghĩa khác nhau cho bước Trắc nghiệm',
    ]);
    expect(
      vocabDeckProblems({
        title: 'Họp',
        stats: { total: 4, withIpa: 4, withExample: 4, distinctMeanings: 4 },
      }),
    ).toEqual([]);
  });

  it('gives the list page what blocks each draft', async () => {
    const decks = [
      {
        id: 2,
        title: 'Draft',
        publicationStatus: 'DRAFT',
        _count: { words: 1 },
      },
      { id: 1, title: 'Live', publicationStatus: 'PUBLISHED' },
    ];
    const prisma = {
      vocabTopic: { findMany: jest.fn().mockResolvedValue(decks) },
      vocabWord: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ topicId: 2, entry: entry('hợp đồng') }]),
      },
    };
    const service = new AdminService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
    );
    const page = (await service.getVocabTopics({ page: '1' })) as any;
    expect(page.items.map((d: any) => [d.id, d.publishProblems])).toEqual([
      [2, ['ít nhất 4 nghĩa khác nhau cho bước Trắc nghiệm']],
      [1, []],
    ]);
    expect(prisma.vocabWord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { topicId: { in: [2] } } }),
    );
  });
});
