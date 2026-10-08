import { BadRequestException, ConflictException } from '@nestjs/common';
import { AiGenerationJobStatus, AiGenerationJobType } from '@prisma/client';
import { AiGeneratorService, PublishContentDto } from './ai-generator.service';

function payload(): PublishContentDto {
  return {
    quizTitle: 'Governed quiz',
    quizQuestions: [
      {
        question: 'Choose one',
        options: ['A', 'B'],
        correctIndex: 0,
        explanation: 'A is correct',
      },
    ],
    publishQuiz: true,
    publishFlashcards: false,
    publishAssignment: false,
  };
}

function serviceWith(prisma: any) {
  return new AiGeneratorService(
    { get: jest.fn(), set: jest.fn() } as any,
    { generateSmartContentFromDocument: jest.fn() } as any,
    prisma,
  );
}

describe('AiGeneratorService Phase 5 governance', () => {
  it('reads completed jobs from PostgreSQL even when Redis has no key', async () => {
    const job = {
      id: 'job-1',
      status: AiGenerationJobStatus.GENERATED,
      generationType: AiGenerationJobType.SMART_CONTENT,
      requestSnapshot: { filename: 'lesson.txt' },
      resultSnapshot: { quizQuestions: [] },
      draftSnapshot: null,
      errorSummary: null,
      attempt: 0,
      createdAt: new Date('2026-10-07T00:00:00Z'),
      completedAt: new Date('2026-10-07T00:01:00Z'),
      reviewedAt: null,
      publishedAt: null,
    };
    const prisma = {
      aiGenerationJob: { findUnique: jest.fn().mockResolvedValue(job) },
    };
    const result = await serviceWith(prisma).getJobStatus('job-1');
    expect(result.lifecycleStatus).toBe(AiGenerationJobStatus.GENERATED);
    expect(result.status).toBe('done');
  });

  it('rejects malformed answer structure before any publish transaction', async () => {
    const prisma = {
      aiGenerationJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job-2',
          status: AiGenerationJobStatus.GENERATED,
          resultSnapshot: { quizQuestions: [] },
        }),
      },
    };
    const invalid = payload();
    invalid.quizQuestions![0].correctIndex = 4;
    await expect(
      serviceWith(prisma).approveDraft('job-2', invalid, 7),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires explicit approval and returns published resources idempotently', async () => {
    const resources = { quizId: 22, vocabTopicId: null, assignmentId: null };
    const prisma = {
      aiGenerationJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job-3',
          status: AiGenerationJobStatus.PUBLISHED,
          publishedResources: resources,
        }),
      },
    };
    const result = await serviceWith(prisma).publishContent(
      'job-3',
      payload(),
      7,
    );
    expect(result).toMatchObject({ ...resources, idempotent: true });
  });

  it('does not publish a generated draft before approval', async () => {
    const prisma = {
      aiGenerationJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job-4',
          status: AiGenerationJobStatus.GENERATED,
          approvedSnapshot: null,
        }),
      },
    };
    await expect(
      serviceWith(prisma).publishContent('job-4', payload(), 7),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
