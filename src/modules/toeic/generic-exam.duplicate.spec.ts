import { GenericExamService } from './generic-exam.service';
import { QuizPublicationStatus } from '@prisma/client';

/**
 * Phase H — "Tạo phiên bản mới" / "Nhân bản đề": the lightweight
 * attempt-safe recovery path for an Exam that already has learner history.
 */
describe('GenericExamService.duplicate — Phase H new version/clone', () => {
  let service: GenericExamService;
  let prisma: any;

  const sourceExam = {
    id: 1,
    title: 'TOEIC Practice Test 01',
    description: 'desc',
    familyCode: 'TOEIC',
    variantCode: 'TOEIC_LR',
    templateKey: 'TOEIC_LR_V1',
    toeicExamSet: {
      id: 101,
      title: 'TOEIC Practice Test 01',
      description: 'desc',
      type: 'FULL_TEST',
      difficulty: 'medium',
      durationSeconds: 7200,
      groups: [
        {
          part: 1,
          canonicalAccent: 'US',
          audioUrl: 'a.mp3',
          imageUrl: 'i.png',
          passageText: null,
          transcriptText: 't',
          imageBrief: 'b',
          mediaMetadata: { audio: { transcriptHash: 'h' } },
          groupOrder: 1,
          questions: [
            {
              questionNumber: 1,
              text: null,
              options: ['a', 'b', 'c', 'd'],
              correctIndex: 1,
              explanation: null,
            },
          ],
        },
      ],
    },
    toeicAssessment: null,
  };

  beforeEach(() => {
    prisma = {
      exam: { findUnique: jest.fn(), create: jest.fn() },
      toeicExamSet: { create: jest.fn() },
      toeicQuestionGroup: { create: jest.fn() },
      toeicAssessment: { create: jest.fn() },
      speakingPracticeSet: { create: jest.fn() },
      speakingExercise: { create: jest.fn() },
      toeicWritingSet: { create: jest.fn() },
      quiz: { create: jest.fn() },
      toeicWritingSetItem: { create: jest.fn() },
      toeicAssessmentComponent: { create: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    service = new GenericExamService(prisma, {} as any);
    jest.spyOn(service as any, 'findExam').mockResolvedValue(sourceExam);
    jest
      .spyOn(service as any, 'getAdmin')
      .mockImplementation((id: number) =>
        Promise.resolve({ id, cloned: true }),
      );

    prisma.exam.create.mockResolvedValue({ id: 999 });
    prisma.toeicExamSet.create.mockResolvedValue({ id: 909 });
  });

  it('creates a new DRAFT Exam, never mutating the original', async () => {
    await service.duplicate(1, 7);

    expect(prisma.exam.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'TOEIC Practice Test 01 — Bản mới',
          publicationStatus: QuizPublicationStatus.DRAFT,
          createdBy: 7,
        }),
      }),
    );
    // Never touches the original Exam/ToeicExamSet rows.
    expect(prisma.exam.create).toHaveBeenCalledTimes(1);
  });

  it('clones groups and questions into the new ToeicExamSet', async () => {
    await service.duplicate(1, 7);

    expect(prisma.toeicExamSet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ examId: 999 }),
      }),
    );
    expect(prisma.toeicQuestionGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          examId: 909,
          part: 1,
          groupOrder: 1,
          questions: {
            create: [
              expect.objectContaining({
                questionNumber: 1,
                correctIndex: 1,
              }),
            ],
          },
        }),
      }),
    );
  });

  it('never creates an attempt, never reads attempt tables', async () => {
    await service.duplicate(1, 7);
    expect(prisma.toeicAttempt).toBeUndefined();
  });

  it('runs entirely inside one transaction', async () => {
    await service.duplicate(1, 7);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns the admin projection of the NEW exam id, not the original', async () => {
    const result = await service.duplicate(1, 7);
    expect((service as any).getAdmin).toHaveBeenCalledWith(999);
    expect(result).toEqual({ id: 999, cloned: true });
  });
});
