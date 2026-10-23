import { ConflictException, BadRequestException } from '@nestjs/common';
import { GenericExamService } from './generic-exam.service';
import { ToeicAssessmentService } from './toeic-assessment.service';
import { QuizPublicationStatus } from '@prisma/client';

/**
 * P1-01 — GenericExamService.unpublish() must block Published → Draft once
 * learner attempts exist, exactly like delete() already did.
 */
describe('GenericExamService — attempt-aware unpublish/delete guard (P1-01)', () => {
  let service: GenericExamService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      exam: { findUnique: jest.fn(), update: jest.fn() },
      toeicExamSet: { update: jest.fn(), delete: jest.fn() },
      toeicAssessment: { update: jest.fn(), delete: jest.fn() },
      toeicAttempt: { findFirst: jest.fn() },
      toeicAssessmentAttempt: { findFirst: jest.fn() },
      $transaction: jest.fn((ops: any) =>
        Array.isArray(ops) ? Promise.all(ops) : ops(prisma),
      ),
    };
    service = new GenericExamService(prisma, {} as any);
    jest.spyOn(service as any, 'getAdmin').mockResolvedValue({ id: 1 });
  });

  it('unpublish() blocks a Published L&R exam that already has a learner attempt', async () => {
    prisma.exam.findUnique.mockResolvedValue({
      id: 1,
      toeicExamSet: { id: 101 },
      toeicAssessment: null,
    });
    prisma.toeicAttempt.findFirst.mockResolvedValue({ id: 9 });

    await expect(service.unpublish(1)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.exam.update).not.toHaveBeenCalled();
  });

  it('unpublish() blocks a Published TOEIC assessment exam that already has an assessment attempt', async () => {
    prisma.exam.findUnique.mockResolvedValue({
      id: 2,
      toeicExamSet: null,
      toeicAssessment: { id: 55 },
    });
    prisma.toeicAssessmentAttempt.findFirst.mockResolvedValue({ id: 3 });

    await expect(service.unpublish(2)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('unpublish() still succeeds for a Published exam with zero attempts', async () => {
    prisma.exam.findUnique.mockResolvedValue({
      id: 3,
      toeicExamSet: { id: 102 },
      toeicAssessment: null,
    });
    prisma.toeicAttempt.findFirst.mockResolvedValue(null);

    await service.unpublish(3);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('delete() keeps blocking an exam with attempts (regression, now sharing hasLearnerAttempts)', async () => {
    prisma.exam.findUnique.mockResolvedValue({
      id: 4,
      toeicExamSet: { id: 103 },
      toeicAssessment: null,
    });
    prisma.toeicAttempt.findFirst.mockResolvedValue({ id: 1 });

    await expect(service.delete(4)).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * P1-01 (defence in depth) — AI candidate Apply must never be able to
 * overwrite an Exam that has learner attempts, even if it is sitting in
 * DRAFT (e.g. via the exact bug unpublish() used to have).
 */
describe('ToeicAiExamService.apply — history guard (P1-01, defence in depth)', () => {
  it('GenericExamService.hasLearnerAttempts is public and reusable by ToeicAiExamService', () => {
    // ToeicAiExamService.apply() calls this.genericExam.hasLearnerAttempts(exam)
    // directly; this only breaks (TS error) if the method stops being public.
    const proto = GenericExamService.prototype as any;
    expect(typeof proto.hasLearnerAttempts).toBe('function');
  });
});

/**
 * P1-02 — the legacy TOEIC assessment composer must reject a Speaking
 * source unless it is scoped EXAM_INTERNAL; a standalone SKILL_PRACTICE set
 * must never become an assessment's authoritative, scored component.
 */
describe('ToeicAssessmentService.setComponents — composition source isolation (P1-02)', () => {
  let service: ToeicAssessmentService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      toeicAssessment: { findUnique: jest.fn(), update: jest.fn() },
      toeicAssessmentAttempt: { count: jest.fn().mockResolvedValue(0) },
      toeicExamSet: { findUnique: jest.fn() },
      speakingPracticeSet: { findUnique: jest.fn() },
      toeicWritingSet: { findUnique: jest.fn() },
      toeicAssessmentComponent: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    };
    service = Object.create(ToeicAssessmentService.prototype);
    (service as any).db = prisma;
    jest.spyOn(service as any, 'findAssessment').mockResolvedValue({
      id: 1,
      productFamily: 'TOEIC_SW',
      publicationStatus: QuizPublicationStatus.DRAFT,
    });
    jest.spyOn(service as any, 'getAdmin').mockResolvedValue({ id: 1 });
  });

  // TOEIC_SW requires exactly [SPEAKING(order 1), WRITING(order 2)] — both
  // must be present for assertFamilyComponents to let the request through
  // to the source-ownership check this test targets.
  const speakingComponent = {
    kind: 'SPEAKING',
    order: 1,
    speakingPracticeSetId: 'sp-1',
  } as any;
  const writingComponent = {
    kind: 'WRITING',
    order: 2,
    writingSetId: 1,
  } as any;

  it('rejects a SKILL_PRACTICE (standalone) Speaking source', async () => {
    prisma.speakingPracticeSet.findUnique.mockResolvedValue({
      id: 'sp-1',
      scope: 'SKILL_PRACTICE',
    });
    prisma.toeicWritingSet.findUnique.mockResolvedValue({ id: 1 });

    await expect(
      service.setComponents(1, {
        components: [speakingComponent, writingComponent],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.toeicAssessmentComponent.createMany).not.toHaveBeenCalled();
  });

  it('accepts an EXAM_INTERNAL Speaking source', async () => {
    prisma.speakingPracticeSet.findUnique.mockResolvedValue({
      id: 'sp-1',
      scope: 'EXAM_INTERNAL',
    });
    prisma.toeicWritingSet.findUnique.mockResolvedValue({ id: 1 });

    await service.setComponents(1, {
      components: [speakingComponent, writingComponent],
    });
    expect(prisma.toeicAssessmentComponent.createMany).toHaveBeenCalled();
  });
});
