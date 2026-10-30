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
