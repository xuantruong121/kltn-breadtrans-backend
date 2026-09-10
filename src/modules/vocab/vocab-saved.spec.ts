import { NotFoundException } from '@nestjs/common';
import { VocabService } from './vocab.service';

describe('VocabService personal saved vocabulary', () => {
  function create() {
    const findMany = jest.fn();
    const upsert = jest.fn<Promise<{ id: number }>, [unknown]>();
    const deleteMany = jest.fn();
    const prisma = {
      userSavedWord: { findMany, upsert, deleteMany },
    };
    const dictionary = {
      lookup: jest.fn().mockResolvedValue({
        query: 'opens',
        canonicalWord: 'open',
        isInflectionMatch: true,
        source: 'EXTERNAL',
        entries: [
          {
            word: 'open',
            partOfSpeech: 'verb',
            meaningVi: 'mở',
            definitions: [
              {
                definition: 'to make accessible',
                meaningVi: 'mở',
                example: null,
              },
            ],
            examples: [],
            collocations: [],
            synonyms: [],
            antonyms: [],
            audio: { us: null, uk: null },
          },
        ],
        matches: [],
      }),
    };
    const service = new VocabService(
      prisma as never,
      { emitAsync: jest.fn() } as never,
      dictionary as never,
    );
    return { service, upsert, deleteMany };
  }

  it('saves an inflection under its canonical identity and is idempotent', async () => {
    const { service, upsert } = create();
    upsert.mockResolvedValue({ id: 8 });
    await service.saveWord(1, 'opens');
    await service.saveWord(1, 'opened');
    expect(upsert).toHaveBeenCalledTimes(2);
    const firstCall = upsert.mock.calls[0][0] as {
      where: { userId_canonicalWord_partOfSpeech: unknown };
    };
    expect(firstCall.where.userId_canonicalWord_partOfSpeech).toEqual({
      userId: 1,
      canonicalWord: 'open',
      partOfSpeech: 'verb',
    });
  });

  it("does not allow deleting another user's saved word", async () => {
    const { service, deleteMany } = create();
    deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.removeSavedWord(2, 8)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 8, userId: 2 },
    });
  });
});
