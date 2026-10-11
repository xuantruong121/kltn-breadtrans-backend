import { BadRequestException } from '@nestjs/common';
import { DiagnosticSpeakingService } from './diagnostic-speaking.service';

describe('DiagnosticSpeakingService', () => {
  const question = {
    id: 10,
    assessmentId: 2,
    skill: 'Speaking',
    question: 'Introduce yourself.',
    options: {
      values: [],
      section: 'SPEAKING',
      questionType: 'OPEN_TEXT',
      stableKey: 'speak-a2-intro',
    },
    correctIndex: -1,
    explanation: null,
    order: 1,
  };
  const response = {
    id: 1,
    userId: 7,
    assessmentId: 2,
    attemptId: 4,
    questionId: 10,
    taskKey: 'speak-a2-intro',
    status: 'GRADED',
    audioKey: 'premium/speaking/diagnostic/2/4/10/a.webm',
    audioMimeType: 'audio/webm',
    byteSize: 2000,
    durationMs: 1200,
    transcript: 'Hello',
    score: 88,
    scoreMetadata: {},
    provider: 'mock',
    graderVersion: 'diagnostic-speaking-v1',
    gradingAttempts: 1,
    failureReason: null,
    createdAt: new Date(),
    confirmedAt: new Date(),
    gradedAt: new Date(),
  };

  it('records and grades a valid microphone response server-side', async () => {
    const prisma: any = {
      diagnosticAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: 4,
          userId: 7,
          assessmentId: 2,
          status: 'IN_PROGRESS',
          speakingResponses: [],
        }),
      },
      diagnosticQuestion: { findFirst: jest.fn().mockResolvedValue(question) },
      diagnosticSpeakingResponse: {
        upsert: jest
          .fn()
          .mockResolvedValue({ ...response, status: 'QUEUED', score: null }),
      },
    };
    const upload = {
      putPrivateObjectAtKey: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new DiagnosticSpeakingService(prisma, upload, {} as any);
    (service as any).queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };
    const result = await service.confirmRecording(
      7,
      2,
      4,
      10,
      {
        buffer: Buffer.alloc(2000, 1),
        size: 2000,
        mimetype: 'audio/webm',
      } as any,
      1200,
    );
    expect(result.status).toBe('QUEUED');
    expect((service as any).queue.add).toHaveBeenCalledWith(
      'diagnostic-speaking-grade',
      expect.objectContaining({ responseId: 1, audioKey: expect.any(String) }),
      expect.objectContaining({
        jobId: expect.stringContaining('diagnostic-speaking-1-'),
      }),
    );
    expect(upload.putPrivateObjectAtKey).toHaveBeenCalledWith(
      expect.stringContaining('premium/speaking/diagnostic/2/4/10/'),
      expect.any(Buffer),
      'audio/webm',
    );
  });

  it('persists skip without turning it into a zero score', async () => {
    const prisma: any = {
      diagnosticAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: 4,
          userId: 7,
          assessmentId: 2,
          status: 'IN_PROGRESS',
          speakingResponses: [],
        }),
      },
      diagnosticQuestion: { findFirst: jest.fn().mockResolvedValue(question) },
      diagnosticSpeakingResponse: {
        upsert: jest
          .fn()
          .mockResolvedValue({ ...response, status: 'SKIPPED', score: null }),
      },
    };
    const service = new DiagnosticSpeakingService(prisma, {} as any, {} as any);
    const result = await service.skip(7, 2, 4, 10);
    expect(result.status).toBe('SKIPPED');
    expect(result.score).toBeNull();
  });

  it('returns after enqueue without waiting for the pronunciation provider', async () => {
    const prisma: any = {
      diagnosticAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: 4,
          userId: 7,
          assessmentId: 2,
          status: 'IN_PROGRESS',
          speakingResponses: [],
        }),
      },
      diagnosticQuestion: { findFirst: jest.fn().mockResolvedValue(question) },
      diagnosticSpeakingResponse: {
        upsert: jest.fn().mockResolvedValue({
          ...response,
          status: 'QUEUED',
          score: null,
        }),
      },
    };
    const ai = {
      assessPronunciation: jest.fn(
        () => new Promise((resolve) => setTimeout(resolve, 2000)),
      ),
    } as any;
    const upload = {
      putPrivateObjectAtKey: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new DiagnosticSpeakingService(prisma, upload, ai);
    (service as any).queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-2' }),
    };
    const startedAt = Date.now();
    const result = await service.confirmRecording(
      7,
      2,
      4,
      10,
      {
        buffer: Buffer.alloc(2000, 1),
        size: 2000,
        mimetype: 'audio/webm',
      } as any,
      1200,
    );
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result.status).toBe('QUEUED');
    expect(ai.assessPronunciation).not.toHaveBeenCalled();
  });

  it('worker grades the queued response and persists a terminal score', async () => {
    const prisma: any = {
      diagnosticSpeakingResponse: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          ...response,
          status: 'QUEUED',
          audioKey: 'premium/speaking/diagnostic/2/4/10/a.webm',
        }),
      },
      diagnosticQuestion: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ question: 'Introduce yourself.' }),
      },
    };
    const upload = {
      downloadPrivateFileBuffer: jest
        .fn()
        .mockResolvedValue(Buffer.alloc(2000, 1)),
    } as any;
    const normalizer = {
      normalize: jest.fn().mockResolvedValue({
        buffer: Buffer.from('canonical-wav'),
        normalizedMime: 'audio/wav',
      }),
    } as any;
    const service = new DiagnosticSpeakingService(
      prisma,
      upload,
      {} as any,
      normalizer,
    );
    const processJob = (
      service as unknown as {
        processGradingJob: (job: unknown) => Promise<void>;
      }
    ).processGradingJob.bind(service);
    await processJob({
      data: { responseId: 1, audioKey: response.audioKey },
    });
    expect(prisma.diagnosticSpeakingResponse.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'QUEUED' }),
      }),
    );
    expect(prisma.diagnosticSpeakingResponse.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 1,
          audioKey: response.audioKey,
          status: 'GRADING',
        }),
        data: expect.objectContaining({ status: 'GRADED', score: 88 }),
      }),
    );
    expect(normalizer.normalize).toHaveBeenCalledWith(
      expect.any(Buffer),
      'audio/webm',
    );
  });

  it('does not call the provider when server-side normalization fails', async () => {
    const prisma: any = {
      diagnosticSpeakingResponse: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          ...response,
          status: 'QUEUED',
          audioKey: response.audioKey,
        }),
      },
      diagnosticQuestion: {
        findUnique: jest.fn().mockResolvedValue({
          question: 'Introduce yourself.',
        }),
      },
    };
    const ai = { assessPronunciation: jest.fn() } as any;
    const upload = {
      downloadPrivateFileBuffer: jest
        .fn()
        .mockResolvedValue(Buffer.alloc(2000, 1)),
    } as any;
    const normalizer = {
      normalize: jest.fn().mockRejectedValue(new Error('invalid media')),
    } as any;
    const service = new DiagnosticSpeakingService(
      prisma,
      upload,
      ai,
      normalizer,
    );
    const processJob = (
      service as unknown as {
        processGradingJob: (job: unknown) => Promise<void>;
      }
    ).processGradingJob.bind(service);
    await processJob({
      data: { responseId: 1, audioKey: response.audioKey },
    });
    expect(ai.assessPronunciation).not.toHaveBeenCalled();
    expect(prisma.diagnosticSpeakingResponse.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'GRADING_FAILED',
          failureReason: 'invalid media',
        }),
      }),
    );
  });

  it('rejects unsupported media before persistence', async () => {
    const prisma: any = {
      diagnosticAttempt: {
        findUnique: jest.fn().mockResolvedValue({
          id: 4,
          userId: 7,
          assessmentId: 2,
          status: 'IN_PROGRESS',
          speakingResponses: [],
        }),
      },
      diagnosticQuestion: { findFirst: jest.fn().mockResolvedValue(question) },
    };
    const service = new DiagnosticSpeakingService(prisma, {} as any, {} as any);
    await expect(
      service.confirmRecording(
        7,
        2,
        4,
        10,
        {
          buffer: Buffer.alloc(2000),
          size: 2000,
          mimetype: 'application/octet-stream',
        } as any,
        1000,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
