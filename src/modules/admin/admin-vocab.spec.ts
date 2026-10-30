import { AdminService } from './admin.service';

const entryRow = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  headword: 'agenda',
  displayWord: 'agenda',
  pos: 'noun',
  ipaUs: null,
  ipaUk: null,
  audioUs: null,
  audioUk: null,
  meaningVi: 'chương trình họp',
  definitionEn: null,
  exampleEn: null,
  exampleVi: null,
  collocations: null,
  synonyms: null,
  antonyms: null,
  source: 'CURATED',
  status: 'APPROVED',
  ...overrides,
});

const deckRow = (
  id: number,
  order: number,
  entry: Record<string, unknown> = entryRow(),
) => ({ id, topicId: 3, entryId: entry.id, order, entry });

describe('AdminService vocab decks', () => {
  const build = (prisma: unknown) =>
    new AdminService(prisma as any, {} as any, {} as any, {} as any, undefined);

  const addPrisma = (existing: unknown = null, inDeck: unknown = null) => ({
    vocabTopic: {
      findUnique: jest.fn().mockResolvedValue({ id: 3 }),
      update: jest.fn(),
    },
    vocabWord: {
      aggregate: jest.fn().mockResolvedValue({ _max: { order: 7 } }),
      findFirst: jest.fn().mockResolvedValue(inDeck),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve(
            deckRow(
              50,
              data.order,
              (existing ?? entryRow()) as Record<string, unknown>,
            ),
          ),
        ),
    },
    dictionaryEntry: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue(entryRow()),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...(existing as object), ...data }),
        ),
    },
  });

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

  it('adds a new word as a curated entry, linked after the last one', async () => {
    const prisma = addPrisma();
    const word = await build(prisma).addVocabWord(3, {
      word: ' Agenda ',
      meaning: 'chương trình họp',
    });
    expect(prisma.dictionaryEntry.findUnique).toHaveBeenCalledWith({
      where: { headword_pos: { headword: 'agenda', pos: 'noun' } },
    });
    expect(prisma.dictionaryEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        headword: 'agenda',
        displayWord: 'Agenda',
        pos: 'noun',
        meaningVi: 'chương trình họp',
      }),
    });
    expect(prisma.vocabWord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { topicId: 3, entryId: 5, order: 8 },
      }),
    );
    expect(word).toEqual(
      expect.objectContaining({
        id: 50,
        word: 'agenda',
        meaning: 'chương trình họp',
        reusedEntry: false,
      }),
    );
  });

  it('keeps an explicit position', async () => {
    const prisma = addPrisma();
    await build(prisma).addVocabWord(3, {
      word: 'minutes',
      meaning: 'biên bản',
      order: 2,
    });
    expect(prisma.vocabWord.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ order: 2 }) }),
    );
  });

  it('reuses the store entry for a known word and only fills its gaps', async () => {
    const existing = entryRow({
      id: 9,
      ipaUs: '/əˈdʒendə/',
      status: 'PENDING_REVIEW',
      source: 'EXTERNAL',
    });
    const prisma = addPrisma(existing);
    const word = await build(prisma).addVocabWord(3, {
      word: 'agenda',
      meaning: 'nghĩa khác',
      ipaUs: '/x/',
      exampleEn: 'The agenda is short.',
    });
    expect(prisma.dictionaryEntry.create).not.toHaveBeenCalled();
    const { data } = prisma.dictionaryEntry.update.mock.calls[0][0];
    expect(data).toEqual(
      expect.objectContaining({
        exampleEn: 'The agenda is short.',
        status: 'APPROVED',
      }),
    );
    // Filled fields of a shared entry are not overwritten from a deck.
    expect(data).not.toHaveProperty('ipaUs');
    expect(data).not.toHaveProperty('meaningVi');
    expect(prisma.vocabWord.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { topicId: 3, entryId: 9, order: 8 } }),
    );
    expect(word.reusedEntry).toBe(true);
  });

  it('refuses the same word twice in one deck', async () => {
    const prisma = addPrisma(entryRow({ id: 9 }), { id: 12 });
    await expect(
      build(prisma).addVocabWord(3, { word: 'agenda', meaning: 'x' }),
    ).rejects.toThrow('đã có trong bộ này');
    expect(prisma.vocabWord.create).not.toHaveBeenCalled();
  });
});

describe('AdminService vocab word edits on a shared entry', () => {
  const build = (prisma: unknown) =>
    new AdminService(prisma as any, {} as any, {} as any, {} as any, undefined);

  const editPrisma = (progress: unknown = null) => ({
    vocabWord: {
      findUnique: jest.fn().mockResolvedValue(deckRow(50, 1)),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(1),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve(deckRow(50, 1, entryRow({ id: data.entryId }))),
        ),
    },
    userVocabWordProgress: { findFirst: jest.fn().mockResolvedValue(progress) },
    dictionaryEntry: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(entryRow({ id: 77 })),
      update: jest.fn(),
    },
  });

  it('blocks a meaning change when any deck using the entry has progress', async () => {
    const prisma = editPrisma({ id: 1 });
    await expect(
      build(prisma).updateVocabWord(3, 50, { meaning: 'nghĩa mới' }),
    ).rejects.toThrow('đã có dữ liệu học tập');
    expect(prisma.userVocabWordProgress.findFirst).toHaveBeenCalledWith({
      where: { word: { entryId: 5 } },
    });
    expect(prisma.dictionaryEntry.update).not.toHaveBeenCalled();
  });

  it('edits the shared entry when the word stays the same', async () => {
    const prisma = editPrisma();
    await build(prisma).updateVocabWord(3, 50, { ipaUs: ' /əˈdʒendə/ ' });
    expect(prisma.userVocabWordProgress.findFirst).not.toHaveBeenCalled();
    expect(prisma.dictionaryEntry.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { ipaUs: '/əˈdʒendə/' },
    });
  });

  it('gives this deck a new entry when the word changes and others share the old one', async () => {
    const prisma = editPrisma();
    await build(prisma).updateVocabWord(3, 50, {
      word: 'minutes',
      meaning: 'biên bản',
    });
    expect(prisma.dictionaryEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        headword: 'minutes',
        displayWord: 'minutes',
        meaningVi: 'biên bản',
      }),
    });
    // The shared entry other decks use is left alone.
    expect(prisma.dictionaryEntry.update).not.toHaveBeenCalled();
    expect(prisma.vocabWord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { entryId: 77 } }),
    );
  });
});

describe('AdminService vocab paging and moves', () => {
  const build = (prisma: unknown) =>
    new AdminService(prisma as any, {} as any, {} as any, {} as any, undefined);

  it('pages the words of a deck in order, with an optional search', async () => {
    const prisma = {
      vocabTopic: { findUnique: jest.fn().mockResolvedValue({ id: 3 }) },
      vocabWord: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...deckRow(21, 21),
            entry: { ...entryRow(), _count: { deckWords: 2 } },
          },
        ]),
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
        where: {
          topicId: 3,
          entry: { OR: expect.any(Array) },
        },
      }),
    );
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 21,
          word: 'agenda',
          meaning: 'chương trình họp',
          usedInDecks: 2,
        }),
      ],
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
            { entry: { meaningVi: 'chương trình' } },
            { entry: { meaningVi: 'biên bản' } },
            { entry: { meaningVi: 'biên bản ' } },
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
