import { ToeicAiExamService } from './toeic-ai-exam.service';
import { AiGenerationJobStatus, QuizPublicationStatus } from '@prisma/client';

jest.mock('./toeic.validation', () => ({
  validateToeicExam: () => ({ learnerReady: true, issues: [] }),
}));

/**
 * Phase E — selective Apply must only write the groups the admin selected,
 * must never duplicate content on a repeated apply of an already-applied
 * key, and must leave full apply-all (no selection) behaving exactly as
 * before for backward compatibility.
 */
describe('ToeicAiExamService.apply — selective candidate apply', () => {
  let service: ToeicAiExamService;
  let prisma: any;
  let tx: any;

  const draftSnapshot = {
    version: 1,
    lrBatches: [
      {
        part: 1,
        groupOrder: 1,
        questionNumber: 1,
        candidate: {
          groups: [
            {
              imageBrief: 'A man at a desk',
              questions: [
                {
                  text: 'Q1',
                  options: ['A', 'B', 'C', 'D'],
                  correctIndex: 0,
                  explanation: 'x',
                },
              ],
            },
            {
              imageBrief: 'A woman walking',
              questions: [
                {
                  text: 'Q2',
                  options: ['A', 'B', 'C', 'D'],
                  correctIndex: 1,
                  explanation: 'y',
                },
              ],
            },
          ],
        },
      },
    ],
  };

  const examRow = {
    id: 1,
    publicationStatus: QuizPublicationStatus.DRAFT,
    toeicExamSet: { id: 10 },
    toeicAssessment: null,
  };

  beforeEach(() => {
    tx = {
      toeicQuestionGroup: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };
    prisma = {
      aiGenerationJob: {
        findUnique: jest.fn().mockResolvedValue({
          createdByAdminId: 7,
          status: AiGenerationJobStatus.GENERATED,
          draftSnapshot,
          resultSnapshot: {},
          approvedSnapshot: null,
          requestSnapshot: { kind: 'TOEIC_PRACTICE_EXAM' },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      exam: { findUnique: jest.fn().mockResolvedValue(examRow) },
      toeicExamSet: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ groups: [] }),
      },
      $transaction: jest.fn((cb) => cb(tx)),
    };
    service = Object.create(ToeicAiExamService.prototype);
    (service as any).prisma = prisma;
    (service as any).genericExam = {
      hasLearnerAttempts: jest.fn().mockResolvedValue(false),
    };
    (service as any).materializeMedia = jest.fn().mockResolvedValue(undefined);
    (service as any).materializeSpeakingWriting = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).status = jest.fn().mockResolvedValue({ ok: true });
  });

  it('applies only the selected candidateKeys, not the whole candidate', async () => {
    await service.apply('job-1', 7, ['LR:P1:G1']);

    // Selective mode must never wipe existing content first.
    expect(tx.toeicQuestionGroup.deleteMany).not.toHaveBeenCalled();
    expect(tx.toeicQuestionGroup.create).toHaveBeenCalledTimes(1);
    expect(tx.toeicQuestionGroup.create.mock.calls[0][0].data.groupOrder).toBe(
      1,
    );

    const updateCall = prisma.aiGenerationJob.update.mock.calls[0][0];
    expect(updateCall.data.approvedSnapshot.appliedCandidateKeys).toEqual([
      'LR:P1:G1',
    ]);
    // Only one of two groups applied -> job stays GENERATED, not APPROVED.
    expect(updateCall.data.status).toBe(AiGenerationJobStatus.GENERATED);
  });

  it('re-applying an already-applied key is a no-op (no duplicate group)', async () => {
    prisma.aiGenerationJob.findUnique.mockResolvedValue({
      createdByAdminId: 7,
      status: AiGenerationJobStatus.GENERATED,
      draftSnapshot,
      resultSnapshot: {},
      approvedSnapshot: { appliedCandidateKeys: ['LR:P1:G1'] },
      requestSnapshot: { kind: 'TOEIC_PRACTICE_EXAM' },
    });

    await service.apply('job-1', 7, ['LR:P1:G1']);

    expect(tx.toeicQuestionGroup.create).not.toHaveBeenCalled();
    const updateCall = prisma.aiGenerationJob.update.mock.calls[0][0];
    expect(updateCall.data.approvedSnapshot.appliedCandidateKeys).toEqual([
      'LR:P1:G1',
    ]);
  });

  it('applying the remaining key after a partial apply completes the job (APPROVED)', async () => {
    prisma.aiGenerationJob.findUnique.mockResolvedValue({
      createdByAdminId: 7,
      status: AiGenerationJobStatus.GENERATED,
      draftSnapshot,
      resultSnapshot: {},
      approvedSnapshot: { appliedCandidateKeys: ['LR:P1:G1'] },
      requestSnapshot: { kind: 'TOEIC_PRACTICE_EXAM' },
    });

    await service.apply('job-1', 7, ['LR:P1:G2']);

    expect(tx.toeicQuestionGroup.create).toHaveBeenCalledTimes(1);
    const updateCall = prisma.aiGenerationJob.update.mock.calls[0][0];
    expect(
      updateCall.data.approvedSnapshot.appliedCandidateKeys.sort(),
    ).toEqual(['LR:P1:G1', 'LR:P1:G2'].sort());
    expect(updateCall.data.status).toBe(AiGenerationJobStatus.APPROVED);
  });

  it('full apply-all (no selection) remains backward compatible: wipes then rewrites everything', async () => {
    await service.apply('job-1', 7);

    expect(tx.toeicQuestionGroup.deleteMany).toHaveBeenCalledWith({
      where: { examId: 10 },
    });
    expect(tx.toeicQuestionGroup.create).toHaveBeenCalledTimes(2);
    const updateCall = prisma.aiGenerationJob.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe(AiGenerationJobStatus.APPROVED);
  });
});
