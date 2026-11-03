import { ToeicAiExamService } from './toeic-ai-exam.service';

describe('exam images', () => {
  afterEach(() => {
    delete process.env.GEMINI_IMAGE_GENERATION;
  });

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
      canGenerateExamImage: () =>
        process.env.GEMINI_IMAGE_GENERATION === 'enabled',
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

  it('downloads photos one at a time and at most three', async () => {
    const service = build(true, [candidate, candidate, candidate, candidate]);
    let running = 0;
    let peak = 0;
    service.imageSearch.download.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return { buffer: png, mimeType: 'image/png' };
    });

    await service.sourceExamImage('s', 'a woman at a desk', 1);

    expect(peak).toBe(1);
    expect(service.imageSearch.download).toHaveBeenCalledTimes(3);
  });

  it('never calls the paid generator unless it is switched on', async () => {
    const service = build(false);
    delete process.env.GEMINI_IMAGE_GENERATION;

    await expect(
      service.sourceExamImage('s', 'a woman at a desk', 1),
    ).rejects.toThrow('no suitable library photo');
    expect(service.ai.generateToeicExamImage).not.toHaveBeenCalled();
  });

  it('falls back to the generator when no photo is suitable', async () => {
    const service = build(false);
    process.env.GEMINI_IMAGE_GENERATION = 'enabled';

    const image = await service.sourceExamImage('s', 'a woman at a desk', 1);

    expect(service.ai.generateToeicExamImage).toHaveBeenCalled();
    expect(image.metadata).toEqual({ source: 'AI_GENERATED' });
  });

  it('falls back when every library fails', async () => {
    const service = build(true);
    process.env.GEMINI_IMAGE_GENERATION = 'enabled';
    service.imageSearch.search.mockRejectedValue(new Error('down'));

    await service.sourceExamImage('s', 'a woman at a desk', 1);

    expect(service.ai.generateToeicExamImage).toHaveBeenCalled();
  });

  it('shortens the query when the full one finds nothing', async () => {
    const service = build(true);
    service.imageSearch.search
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate]);

    const image = await service.sourceExamImage(
      's',
      'A person sitting at a desk typing on a laptop computer',
      1,
    );

    expect(
      service.imageSearch.search.mock.calls.map((call: any) => call[0]),
    ).toEqual(['person sitting desk typing laptop', 'person sitting desk']);
    expect(image.metadata).toMatchObject({ provider: 'OPENVERSE' });
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
    const group = { questions: [{ id: 7, options: ['old'] }] };

    await service.matchPart1QuestionToImage(group, metadata, {
      buffer: png,
      mimeType: 'image/png',
      metadata: { provenance: 'EXTERNAL_LIBRARY' },
    });

    const saved = update.mock.calls[0][0].data;
    expect(saved.options[saved.correctIndex]).toBe('B');
    expect(metadata.image?.questionStatus).toBe('READY_FOR_REVIEW');
    // Audio is scripted from this object straight after the match.
    expect(group.questions[0].options).toEqual(saved.options);
  });

  describe('fillMissingImages', () => {
    const fixture = () => {
      const service = build(true);
      service.editableDraft = jest
        .fn()
        .mockResolvedValue({ toeicExamSet: { id: 3 } });
      service.regenerateMedia = jest.fn().mockResolvedValue({});
      service.prisma = {
        toeicQuestionGroup: {
          findMany: jest.fn().mockResolvedValue([{ id: 8, groupOrder: 1 }]),
        },
        exam: {
          findUnique: jest.fn().mockResolvedValue({
            aiGenerationJobId: 'job',
            toeicAssessment: {
              components: [
                { kind: 'SPEAKING', speakingPracticeSetId: 11 },
                { kind: 'WRITING', writingSetId: 22 },
              ],
            },
          }),
        },
        aiGenerationJob: {
          findUnique: jest.fn().mockResolvedValue({
            draftSnapshot: {
              speakingWriting: {
                speaking: [{}, {}, { imageBrief: 'team meeting' }],
                writing: [{ imageBrief: 'office desk' }, {}],
              },
            },
          }),
        },
        speakingExercise: {
          findMany: jest.fn().mockResolvedValue([
            { id: 31, order: 3 },
            { id: 32, order: 5 },
          ]),
          update: jest.fn(),
        },
        toeicWritingSetItem: {
          findMany: jest.fn().mockResolvedValue([
            {
              order: 1,
              writingQuiz: {
                questions: [{ id: 41, content: { prompt: 'Viết' } }],
              },
            },
            {
              order: 2,
              writingQuiz: {
                questions: [{ id: 42, content: { prompt: 'Email' } }],
              },
            },
          ]),
        },
        question: { update: jest.fn() },
      };
      return service;
    };

    it('fills empty slots and skips tasks with no image brief', async () => {
      const service = fixture();

      const result = await service.fillMissingImages(5);

      expect(result).toEqual({
        filled: ['Part 1 nhóm 1', 'Speaking câu 3', 'Writing câu 1'],
        missing: [],
      });
      expect(service.prisma.speakingExercise.update).toHaveBeenCalledWith({
        where: { id: 31 },
        data: { imageUrl: 'https://r2.test/a.png' },
      });
      expect(service.prisma.question.update).toHaveBeenCalledTimes(1);
      expect(
        service.prisma.question.update.mock.calls[0][0].data.content,
      ).toMatchObject({ prompt: 'Viết', imageUrl: 'https://r2.test/a.png' });
    });

    it('reports a slot it could not fill and carries on', async () => {
      const service = fixture();
      service.regenerateMedia.mockRejectedValue(new Error('down'));

      const result = await service.fillMissingImages(5);

      expect(result.missing).toEqual(['Part 1 nhóm 1']);
      expect(result.filled).toContain('Writing câu 1');
    });

    it('refuses an exam that is not an editable Draft', async () => {
      const service = fixture();
      service.editableDraft.mockRejectedValue(new Error('Chỉ Draft'));

      await expect(service.fillMissingImages(5)).rejects.toThrow('Chỉ Draft');
    });
  });
});
