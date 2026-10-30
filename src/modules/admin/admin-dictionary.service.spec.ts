import {
  AdminDictionaryService,
  dictionaryListWhere,
} from './admin-dictionary.service';

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  headword: 'agenda',
  displayWord: 'agenda',
  pos: 'noun',
  meaningVi: 'chương trình họp',
  status: 'PENDING_REVIEW',
  ...overrides,
});

describe('dictionaryListWhere', () => {
  it('combines search, status, source, part of speech and a missing field', () => {
    expect(
      dictionaryListWhere({
        q: ' Agenda ',
        status: 'PENDING_REVIEW',
        source: 'EXTERNAL',
        pos: 'Noun',
        missing: 'audio',
      }),
    ).toEqual({
      AND: [
        {
          OR: [
            { headword: { contains: 'agenda' } },
            { meaningVi: { contains: 'Agenda', mode: 'insensitive' } },
          ],
        },
        { status: 'PENDING_REVIEW' },
        { source: 'EXTERNAL' },
        { pos: 'noun' },
        { OR: [{ audioUs: null }, { audioUs: '' }] },
      ],
    });
  });

  it('ignores unknown filter values', () => {
    expect(
      dictionaryListWhere({ status: 'DROP', source: 'x', missing: 'id' }),
    ).toEqual({});
  });
});

describe('AdminDictionaryService', () => {
  const build = (prisma: unknown) =>
    new AdminDictionaryService(prisma as never);

  it('pages entries with deck usage and a count per status', async () => {
    const prisma = {
      dictionaryEntry: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...entry(), _count: { deckWords: 2 } }]),
        count: jest.fn().mockResolvedValue(41),
        groupBy: jest.fn().mockResolvedValue([
          { status: 'APPROVED', _count: { _all: 30 } },
          { status: 'PENDING_REVIEW', _count: { _all: 11 } },
        ]),
      },
    };
    const result = await build(prisma).list({ page: 3, pageSize: 20 });
    expect(prisma.dictionaryEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 40, take: 20, where: {} }),
    );
    expect(result).toEqual({
      items: [expect.objectContaining({ id: 7, usedInDecks: 2 })],
      total: 41,
      page: 3,
      pageSize: 20,
      statusCounts: { APPROVED: 30, PENDING_REVIEW: 11, REJECTED: 0 },
    });
  });

  it('creates a curated, approved entry and refuses a taken word', async () => {
    const prisma = {
      dictionaryEntry: {
        findUnique: jest.fn().mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue(entry()),
      },
    };
    await build(prisma).create(
      { word: ' Agenda ', meaning: ' chương trình họp ', ipaUs: '' },
      4,
    );
    expect(prisma.dictionaryEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        headword: 'agenda',
        displayWord: 'Agenda',
        pos: 'noun',
        meaningVi: 'chương trình họp',
        ipaUs: null,
        source: 'CURATED',
        status: 'APPROVED',
        reviewedBy: 4,
      }),
    });

    prisma.dictionaryEntry.findUnique.mockResolvedValueOnce(entry());
    await expect(
      build(prisma).create({ word: 'agenda', meaning: 'x' }, 4),
    ).rejects.toThrow('đã có trong kho từ điển');
  });

  it('refuses a number as a word', async () => {
    const prisma = { dictionaryEntry: { findUnique: jest.fn() } };
    await expect(
      build(prisma).create({ word: '9:00', meaning: 'chín giờ' }, 4),
    ).rejects.toThrow('Số không dùng làm từ vựng');
  });

  it('blocks changing a studied word or meaning, allows other fields', async () => {
    const prisma = {
      dictionaryEntry: {
        findUnique: jest.fn().mockResolvedValue(entry()),
        update: jest.fn().mockResolvedValue(entry()),
      },
      userVocabWordProgress: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };
    await expect(
      build(prisma).update(7, { meaning: 'nghĩa khác' }),
    ).rejects.toThrow('Học viên đã học từ này');
    expect(prisma.userVocabWordProgress.findFirst).toHaveBeenCalledWith({
      where: { word: { entryId: 7 } },
    });

    await build(prisma).update(7, { exampleEn: 'Read the agenda.' });
    expect(prisma.dictionaryEntry.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { exampleEn: 'Read the agenda.' },
    });
  });

  it('approves with the reviewer recorded', async () => {
    const prisma = {
      dictionaryEntry: {
        findUnique: jest.fn().mockResolvedValue(entry()),
        update: jest.fn(),
      },
    };
    await build(prisma).approve(7, 4);
    expect(prisma.dictionaryEntry.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        status: 'APPROVED',
        reviewedAt: expect.any(Date),
        reviewedBy: 4,
      },
    });
  });

  it('will not reject or delete an entry a deck uses', async () => {
    const prisma = {
      dictionaryEntry: {
        findUnique: jest.fn().mockResolvedValue(entry()),
        update: jest.fn(),
        delete: jest.fn(),
      },
      vocabWord: { count: jest.fn().mockResolvedValue(2) },
    };
    await expect(build(prisma).reject(7, 4)).rejects.toThrow('trong 2 bộ');
    await expect(build(prisma).remove(7)).rejects.toThrow('trong 2 bộ');
    expect(prisma.dictionaryEntry.update).not.toHaveBeenCalled();
    expect(prisma.dictionaryEntry.delete).not.toHaveBeenCalled();

    prisma.vocabWord.count.mockResolvedValue(0);
    await build(prisma).remove(7);
    expect(prisma.dictionaryEntry.delete).toHaveBeenCalledWith({
      where: { id: 7 },
    });
  });
});
