import { ToeicAiExamService } from './toeic-ai-exam.service';

describe('ToeicAiExamService image suitability input', () => {
  it('sends the normalized high-quality download URL to Vision, not the preview URL', async () => {
    const candidate = {
      provider: 'PIXABAY' as const,
      providerAssetId: '123',
      previewUrl: 'https://cdn.pixabay.com/preview.jpg',
      downloadUrl: 'https://cdn.pixabay.com/large.jpg',
      sourcePageUrl: 'https://pixabay.com/photos/123',
      width: 1280,
      height: 768,
      author: 'qa',
      tags: ['office'],
      license: 'Pixabay Content License',
    };
    const service = Object.create(ToeicAiExamService.prototype);
    service.logger = { log: jest.fn(), warn: jest.fn() };
    service.imageCandidates = new Map();
    service.editableDraft = jest
      .fn()
      .mockResolvedValue({ toeicExamSet: { id: 10 } });
    service.prisma = {
      toeicQuestionGroup: {
        findFirst: jest.fn().mockResolvedValue({ id: 5, part: 1 }),
      },
    };
    service.imageSearch = {
      search: jest.fn().mockResolvedValue([candidate]),
      download: jest.fn().mockResolvedValue({
        buffer: Buffer.from('valid-image'),
        mimeType: 'image/jpeg',
      }),
    };
    service.ai = {
      analyzeToeicPart1Candidates: jest.fn().mockResolvedValue([
        {
          candidateId: 'pixabay:qa-id',
          status: 'SUITABLE',
          suitable: true,
          score: 0.9,
          sceneSummary: 'Workers meet in an office.',
          visibleFacts: ['workers', 'office'],
          unsafeInferences: [],
          rejectionReasons: [],
        },
      ]),
    };

    await service.searchPart1Images(1, 5, 'workers meeting office', 1);

    expect(service.imageSearch.download).toHaveBeenCalledWith(candidate);
    expect(service.ai.analyzeToeicPart1Candidates).toHaveBeenCalledWith({
      candidates: [
        expect.objectContaining({
          imageBuffer: Buffer.from('valid-image'),
          mimeType: 'image/jpeg',
        }),
      ],
    });
  });

  it('turns a stalled external stage into a bounded service error', async () => {
    const service = Object.create(ToeicAiExamService.prototype);
    service.logger = { log: jest.fn(), warn: jest.fn() };

    await expect(
      service.runBoundedStage(
        'qa-timeout',
        'vision_analysis',
        5,
        () => new Promise(() => undefined),
      ),
    ).rejects.toThrow('quá thời gian xử lý');

    expect(service.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('stage=vision_analysis'),
    );
  });
});
