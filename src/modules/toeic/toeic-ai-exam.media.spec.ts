import { ToeicAiExamService } from './toeic-ai-exam.service';

describe('ToeicAiExamService partial media materialization', () => {
  it('continues the job and persists soft failures per media asset', async () => {
    const questionGroupUpdates: Array<{ where: any; data: any }> = [];
    const service = Object.create(ToeicAiExamService.prototype);
    service.logger = { warn: jest.fn() };
    service.prisma = {
      aiGenerationJob: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          resultSnapshot: {},
          status: 'PROCESSING',
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      toeicQuestionGroup: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 101,
            part: 1,
            imageBrief: 'A manager reviewing a report in an office.',
            transcriptText: 'Woman: The meeting starts at nine.',
            mediaMetadata: {},
          },
          {
            id: 102,
            part: 2,
            imageBrief: null,
            transcriptText: 'Man: Could you send the report?',
            mediaMetadata: {},
          },
        ]),
        update: jest.fn().mockImplementation((args) => {
          questionGroupUpdates.push(args);
          return args;
        }),
      },
    };
    service.ai = {
      generateToeicExamImage: jest
        .fn()
        .mockRejectedValue(new Error('429 quota exceeded')),
    };
    service.r2 = {};
    service.makeAudio = jest
      .fn()
      .mockRejectedValue(new Error('provider timeout'));

    await service.materializeMedia('qa-job', 22);

    expect(questionGroupUpdates).toHaveLength(3);
    expect(questionGroupUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          where: { id: 101 },
          data: expect.objectContaining({ imageUrl: null }),
        }),
        expect.objectContaining({
          where: { id: 101 },
          data: expect.objectContaining({ audioUrl: null }),
        }),
        expect.objectContaining({
          where: { id: 102 },
          data: expect.objectContaining({ audioUrl: null }),
        }),
      ]),
    );
    expect(questionGroupUpdates[0].data.mediaMetadata.image).toMatchObject({
      source: 'AI_GENERATED',
      status: 'FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    expect(questionGroupUpdates[0].data.imageUrl).toBeNull();
    expect(service.prisma.aiGenerationJob.update).toHaveBeenCalled();
  });
});
