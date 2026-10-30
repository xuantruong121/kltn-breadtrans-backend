import { AdminService } from './admin.service';

describe('AdminService vocab decks', () => {
  const build = (prisma: unknown) =>
    new AdminService(prisma as any, {} as any, {} as any, {} as any, undefined);

  it('stores the description and level and starts the word count at 0', async () => {
    const prisma = {
      vocabTopic: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    await build(prisma).createVocabTopic({
      title: 'Office meetings',
      description: '  Từ vựng khi họp  ',
      level: 'B1',
    });
    expect(prisma.vocabTopic.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: 'Từ vựng khi họp',
        level: 'B1',
        totalWords: 0,
      }),
    });
  });

  it('adds a word without a position after the last one', async () => {
    const prisma = {
      vocabTopic: {
        findUnique: jest.fn().mockResolvedValue({ id: 3 }),
        update: jest.fn(),
      },
      vocabWord: {
        aggregate: jest.fn().mockResolvedValue({ _max: { order: 7 } }),
        create: jest.fn().mockResolvedValue({ id: 50 }),
      },
    };
    await build(prisma).addVocabWord(3, {
      word: 'agenda',
      meaning: 'chương trình họp',
    });
    expect(prisma.vocabWord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ order: 8 }),
    });
  });

  it('keeps an explicit position', async () => {
    const prisma = {
      vocabTopic: {
        findUnique: jest.fn().mockResolvedValue({ id: 3 }),
        update: jest.fn(),
      },
      vocabWord: {
        aggregate: jest.fn().mockResolvedValue({ _max: { order: 7 } }),
        create: jest.fn().mockResolvedValue({ id: 51 }),
      },
    };
    await build(prisma).addVocabWord(3, {
      word: 'minutes',
      meaning: 'biên bản',
      order: 2,
    });
    expect(prisma.vocabWord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ order: 2 }),
    });
  });
});

describe('AdminService vocab paging and moves', () => {
  const build = (prisma: unknown) =>
    new AdminService(prisma as any, {} as any, {} as any, {} as any, undefined);

  it('pages the words of a deck in order, with an optional search', async () => {
    const prisma = {
      vocabTopic: { findUnique: jest.fn().mockResolvedValue({ id: 3 }) },
      vocabWord: {
        findMany: jest.fn().mockResolvedValue([{ id: 21 }]),
        count: jest.fn().mockResolvedValue(45),
      },
    };
    const result = await build(prisma).getVocabWordsPage(3, {
      page: 2,
      pageSize: 20,
      q: 'meet',
    });
    expect(prisma.vocabWord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 20,
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        where: expect.objectContaining({ topicId: 3, OR: expect.any(Array) }),
      }),
    );
    expect(result).toEqual({
      items: [{ id: 21 }],
      total: 45,
      page: 2,
      pageSize: 20,
    });
  });

  it('summarizes a deck for the checklist without loading every word', async () => {
    const prisma = {
      vocabTopic: {
        findUnique: jest.fn().mockResolvedValue({ id: 3, title: 'Họp' }),
      },
      vocabWord: {
        count: jest
          .fn()
          .mockResolvedValueOnce(40)
          .mockResolvedValueOnce(38)
          .mockResolvedValueOnce(35)
          .mockResolvedValueOnce(2),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { meaning: 'chương trình' },
            { meaning: 'biên bản' },
          ]),
      },
    };
    const summary = await build(prisma).getVocabTopicSummary(3);
    expect(summary.stats).toEqual({
      total: 40,
      withIpa: 38,
      withExample: 35,
      withAudio: 2,
      distinctMeanings: 2,
      sampleMeanings: ['chương trình', 'biên bản'],
    });
  });

  it('swaps a word with its neighbour', async () => {
    const tx = { vocabWord: { update: jest.fn() } };
    const prisma = {
      vocabWord: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 9, topicId: 3, order: 4 }),
        findFirst: jest.fn().mockResolvedValue({ id: 7, topicId: 3, order: 3 }),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest
        .fn()
        .mockImplementation((ops: unknown[]) => Promise.all(ops)),
    };
    (prisma as any).vocabWord.update = tx.vocabWord.update;
    await build(prisma).moveVocabWord(3, 9, -1);
    expect(tx.vocabWord.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { order: 3 },
    });
    expect(tx.vocabWord.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { order: 4 },
    });
  });

  it('refuses a number as a vocabulary word', async () => {
    const prisma = {
      vocabTopic: { findUnique: jest.fn().mockResolvedValue({ id: 3 }) },
      vocabWord: { aggregate: jest.fn(), create: jest.fn() },
    };
    await expect(
      build(prisma).addVocabWord(3, { word: '10', meaning: 'số mười' } as any),
    ).rejects.toThrow('Số không dùng làm từ vựng');
    expect(prisma.vocabWord.create).not.toHaveBeenCalled();
  });
});

describe('AdminService keeps the Speaking lookup dictionary out of the CMS', () => {
  const build = (prisma: unknown) =>
    new AdminService(prisma as any, {} as any, {} as any, {} as any, undefined);

  it('lists decks without the system dictionary', async () => {
    const prisma = {
      vocabTopic: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await build(prisma).getVocabTopics();
    expect(prisma.vocabTopic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { categoryName: { not: 'SYSTEM_DICTIONARY' } },
      }),
    );
  });

  it('refuses a deck in the system category', async () => {
    const prisma = { vocabTopic: { create: jest.fn() } };
    await expect(
      build(prisma).createVocabTopic({
        title: 'X',
        categoryName: 'SYSTEM_DICTIONARY',
      } as any),
    ).rejects.toThrow('dành cho hệ thống');
    expect(prisma.vocabTopic.create).not.toHaveBeenCalled();
  });
});
