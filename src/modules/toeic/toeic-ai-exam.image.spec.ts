import { ToeicAiExamService } from './toeic-ai-exam.service';

describe('exam images', () => {
  const candidate = {
    provider: 'OPENVERSE',
    providerAssetId: 'a1',
    sourcePageUrl: 'https://example.test/a1',
    author: 'Tác giả',
    license: 'CC0',
  };
  const png = Buffer.from('image');
  const build = (suitable: boolean, found = [candidate]) => {
    const service = Object.create(ToeicAiExamService.prototype);
    service.logger = { warn: jest.fn() };
    service.imageSearch = {
      search: jest.fn().mockResolvedValue(found),
      download: jest
        .fn()
        .mockResolvedValue({ buffer: png, mimeType: 'image/png' }),
    };
    service.ai = {
      analyzeToeicPart1Candidates: jest
        .fn()
        .mockResolvedValue([{ candidateId: '0', suitable, score: 80 }]),
      generateToeicExamImage: jest
        .fn()
        .mockResolvedValue({ buffer: png, mimeType: 'image/png' }),
    };
    service.r2 = {
      putObjectAtKey: jest
        .fn()
        .mockResolvedValue({ url: 'https://r2.test/a.png', key: 'a.png' }),
      objectExists: jest.fn().mockResolvedValue(true),
    };
    service.assertImage = jest.fn();
    return service;
  };

  it('uses a suitable library photo and keeps its license', async () => {
    const service = build(true);

    const image = await service.sourceExamImage('s', 'a woman at a desk', 1);

    expect(service.ai.generateToeicExamImage).not.toHaveBeenCalled();
    expect(image.metadata).toMatchObject({
      provenance: 'EXTERNAL_LIBRARY',
      provider: 'OPENVERSE',
      license: 'CC0',
    });
  });

  it('falls back to the generator when no photo is suitable', async () => {
    const service = build(false);

    const image = await service.sourceExamImage('s', 'a woman at a desk', 1);

    expect(service.ai.generateToeicExamImage).toHaveBeenCalled();
    expect(image.metadata).toEqual({ source: 'AI_GENERATED' });
  });

  it('falls back when every library fails', async () => {
    const service = build(true);
    service.imageSearch.search.mockRejectedValue(new Error('down'));

    await service.sourceExamImage('s', 'a woman at a desk', 1);

    expect(service.ai.generateToeicExamImage).toHaveBeenCalled();
  });

  it('rewrites a Part 1 question to match a library photo', async () => {
    const service = build(true);
    const update = jest.fn();
    service.prisma = { toeicQuestion: { update } };
    service.ai.generateToeicPart1FromImage = jest.fn().mockResolvedValue({
      statements: ['A', 'B', 'C', 'D'],
      correctIndex: 1,
      explanation: 'Giải thích',
      sceneSummary: 'Cảnh',
    });
    service.assertPart1QuestionCandidate = jest.fn();
    const metadata: { image?: Record<string, unknown> } = { image: {} };

    await service.matchPart1QuestionToImage(
      { questions: [{ id: 7 }] },
      metadata,
      {
        buffer: png,
        mimeType: 'image/png',
        metadata: { provenance: 'EXTERNAL_LIBRARY' },
      },
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ correctIndex: 1 }),
    });
    expect(metadata.image?.questionStatus).toBe('READY_FOR_REVIEW');
  });
});
