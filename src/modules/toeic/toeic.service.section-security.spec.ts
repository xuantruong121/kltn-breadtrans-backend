import { BadRequestException } from '@nestjs/common';
import {
  AttemptMode,
  AttemptStatus,
  ToeicAttemptSection,
} from '@prisma/client';
import { ToeicService } from './toeic.service';

/**
 * Phase 1 — cross-section answer security. During Listening, Reading
 * answers must be rejected; once the section moves to Reading, Listening
 * answers become read-only (closed), even though the question legitimately
 * belongs to the exam.
 */
describe('ToeicService — strict section write security', () => {
  let prisma: any;
  let service: ToeicService;

  const listeningQuestion = { id: 1, options: ['a', 'b'], group: { part: 2 } };
  const readingQuestion = { id: 2, options: ['a', 'b'], group: { part: 5 } };

  const baseAttempt = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    userId: 7,
    examId: 50,
    mode: AttemptMode.FULL_TEST,
    status: AttemptStatus.IN_PROGRESS,
    section: ToeicAttemptSection.LISTENING,
    deadline: new Date(Date.now() + 1000 * 60 * 60),
    readingDeadline: null,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        callback(prisma),
      ),
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      toeicAttempt: { findUnique: jest.fn(), update: jest.fn() },
      toeicQuestion: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new ToeicService(prisma, {} as any);
  });

  it('rejects a Reading answer while the attempt is still in Listening', async () => {
    prisma.toeicAttempt.findUnique.mockResolvedValue(baseAttempt());
    prisma.toeicQuestion.findMany.mockResolvedValue([readingQuestion]);

    await expect(
      service.saveAnswers(1, 7, { answers: { '2': 0 } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects mutating a closed Listening answer once the section is Reading', async () => {
    prisma.toeicAttempt.findUnique.mockResolvedValue(
      baseAttempt({ section: ToeicAttemptSection.READING }),
    );
    prisma.toeicQuestion.findMany.mockResolvedValue([listeningQuestion]);

    await expect(
      service.saveAnswers(1, 7, { answers: { '1': 0 } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows a Listening answer while the attempt is still in Listening', async () => {
    prisma.toeicAttempt.findUnique.mockResolvedValue(baseAttempt());
    prisma.toeicQuestion.findMany.mockResolvedValue([listeningQuestion]);

    await expect(
      service.saveAnswers(1, 7, { answers: { '1': 0 } }),
    ).resolves.toEqual({ success: true });
  });

  it('allows a Reading answer once the section is Reading', async () => {
    prisma.toeicAttempt.findUnique.mockResolvedValue(
      baseAttempt({ section: ToeicAttemptSection.READING }),
    );
    prisma.toeicQuestion.findMany.mockResolvedValue([readingQuestion]);

    await expect(
      service.saveAnswers(1, 7, { answers: { '2': 0 } }),
    ).resolves.toEqual({ success: true });
  });

  it('Practice mode (no section) is never cross-section-gated', async () => {
    prisma.toeicAttempt.findUnique.mockResolvedValue(
      baseAttempt({ mode: AttemptMode.PRACTICE, section: null }),
    );
    prisma.toeicQuestion.findMany.mockResolvedValue([readingQuestion]);

    await expect(
      service.saveAnswers(1, 7, { answers: { '2': 0 } }),
    ).resolves.toEqual({ success: true });
  });
});
