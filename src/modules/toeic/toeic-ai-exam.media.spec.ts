import { ToeicAiExamService } from './toeic-ai-exam.service';

describe('ToeicAiExamService partial media materialization', () => {
  it('keeps a Speaking/Writing candidate recoverable when AI image generation fails', async () => {
    const service: any = Object.create(ToeicAiExamService.prototype);
    service.logger = { warn: jest.fn() };
    service.ai = {
      generateToeicExamImage: jest
        .fn()
        .mockRejectedValue(new Error('provider timeout')),
    };

    const result = await service.generatedImageUrl(
      'exam-qa/writing/1',
      'A customer speaking to a receptionist at a hotel desk.',
      1,
    );

    expect(result).toMatchObject({
      url: null,
      metadata: {
        image: {
          source: 'AI_GENERATED',
          status: 'FAILED',
          errorCode: 'PROVIDER_UNAVAILABLE',
        },
      },
    });
    expect(service.logger.warn).toHaveBeenCalled();
  });

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
            transcriptText: null,
            mediaMetadata: {},
            questions: [
              {
                options: ['a', 'b', 'c', 'd'],
                correctIndex: 0,
              },
            ],
          },
          {
            id: 102,
            part: 2,
            imageBrief: null,
            transcriptText: 'Man: Could you send the report?',
            mediaMetadata: {},
            questions: [
              {
                options: ['Yes, I can.', 'At noon.', 'On the desk.'],
                correctIndex: 0,
              },
            ],
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

  it('persists a validated candidate before Apply without mutating the Draft', async () => {
    const updates: any[] = [];
    const service: any = Object.create(ToeicAiExamService.prototype);
    service.prisma = {
      aiGenerationJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'qa-job',
          status: 'QUEUED',
          requestSnapshot: {
            kind: 'TOEIC_PRACTICE_EXAM',
            variantCode: 'TOEIC_LR',
            mode: 'PART',
            part: 5,
            difficulty: 'medium',
            plan: { 5: [{ questionCount: 1 }] },
          },
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          resultSnapshot: { parts: {} },
          status: 'PROCESSING',
        }),
        update: jest.fn().mockImplementation((args) => {
          updates.push(args);
          return args;
        }),
      },
      exam: {
        findUnique: jest.fn().mockResolvedValue({
          id: 814,
          toeicExamSet: { id: 22, difficulty: 'medium' },
          toeicAssessment: null,
        }),
      },
      toeicAttempt: { count: jest.fn().mockResolvedValue(0) },
      toeicQuestionGroup: { create: jest.fn() },
    };
    service.ai = {
      generateToeicExamBatch: jest.fn().mockResolvedValue({
        groups: [
          {
            questions: [
              {
                text: 'Please submit the report by Friday.',
                options: ['report', 'reports', 'reporting', 'reported'],
                correctIndex: 0,
                explanation:
                  'Sau giới từ by trong ngữ cảnh này cần danh từ report.',
              },
            ],
          },
        ],
      }),
    };

    await service.process({ data: { jobId: 'qa-job' } });

    expect(service.prisma.toeicQuestionGroup.create).not.toHaveBeenCalled();
    expect(updates.at(-1).data).toMatchObject({
      status: 'GENERATED',
      draftSnapshot: {
        version: 1,
        lrBatches: [expect.objectContaining({ part: 5, questionNumber: 1 })],
      },
      resultSnapshot: expect.objectContaining({ stage: 'READY_FOR_REVIEW' }),
    });
  });
});
