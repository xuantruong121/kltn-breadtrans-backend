import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { SpeakingService } from './speaking.service';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';

describe('SpeakingService - Phase 2 Presigned R2 Upload & Finalization', () => {
  let service: SpeakingService;
  let mockPrisma: any;
  let mockAiService: any;
  let mockUploadService: any;
  let mockWorker: any;
  let mockQueueService: any;

  const mockExercise = {
    id: 1,
    title: 'Test Read Aloud',
    targetText: 'Hello world',
    difficulty: 'BEGINNER',
    category: 'GENERAL',
  };

  beforeEach(() => {
    mockPrisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn((cb: (tx: typeof mockPrisma) => Promise<unknown>) =>
        cb(mockPrisma),
      ),
      speakingExercise: {
        findUnique: jest.fn().mockResolvedValue(mockExercise),
        findMany: jest.fn().mockResolvedValue([mockExercise]),
      },
      speakingSubmission: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 101,
            submittedAt: new Date('2026-09-30T10:00:00.000Z'),
            ...data,
          }),
        ),
      },
      speakingUploadIntent: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...data,
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockAiService = {
      assessPronunciation: jest.fn(),
      evaluateSpeakingPart3To5: jest.fn(),
    };

    mockUploadService = {
      getPresignedUploadUrl: jest
        .fn()
        .mockImplementation((key) =>
          Promise.resolve(
            `https://r2.storage.example/upload/${key}?signed=true`,
          ),
        ),
      headObject: jest.fn().mockResolvedValue({
        contentLength: 640000,
        contentType: 'audio/wav',
        etag: 'mock-etag-123',
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      getPublicUrl: jest.fn().mockReturnValue('https://r2-public.example.com'),
      getPresignedDownloadUrl: jest
        .fn()
        .mockResolvedValue('https://signed-dl.example/audio'),
    };

    mockWorker = {
      triggerProcessing: jest.fn(),
    };

    mockQueueService = {
      enqueueSubmission: jest.fn().mockResolvedValue(undefined),
    };

    service = new SpeakingService(
      mockPrisma,
      mockAiService,
      mockUploadService,
      mockWorker,
      mockQueueService,
    );
  });

  describe('Capabilities', () => {
    it('returns presigned capability by default', () => {
      const caps = service.getCapabilities();
      expect(caps.uploadMode).toBe('presigned');
      expect(caps.maxSizeBytes).toBe(10 * 1024 * 1024);
      expect(caps.maxDurationMs).toBe(45000);
      expect(caps.allowedContentTypes).toContain('audio/wav');
    });

    it('respects SPEAKING_AUDIO_UPLOAD_MODE=proxy if explicitly configured', () => {
      const orig = process.env.SPEAKING_AUDIO_UPLOAD_MODE;
      try {
        process.env.SPEAKING_AUDIO_UPLOAD_MODE = 'proxy';
        const caps = service.getCapabilities();
        expect(caps.uploadMode).toBe('proxy');
      } finally {
        process.env.SPEAKING_AUDIO_UPLOAD_MODE = orig;
      }
    });
  });

  describe('Step A: createUploadIntent', () => {
    const validDto: CreateUploadIntentDto = {
      contentType: 'audio/wav',
      sizeBytes: 640000,
      durationMs: 20000,
      idempotencyKey: 'idemp-intent-001',
    };

    it('creates an upload intent and returns presigned PUT URL with server-generated key', async () => {
      const result = await service.createUploadIntent(1, 10, validDto);

      expect(result.uploadIntentId).toBeDefined();
      expect(result.uploadUrl).toContain('https://r2.storage.example/upload/');
      expect(result.signedHeaders!['Content-Type']).toBe('audio/wav');
      expect(result.objectKey).toMatch(
        /^speaking\/pending\/10\/[0-9a-f-]+\.wav$/,
      );
      expect(result.maxSizeBytes).toBe(10485760);
      expect(result.isAlreadyFinalized).toBe(false);

      expect(mockPrisma.speakingUploadIntent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 10,
            exerciseId: 1,
            expectedContentType: 'audio/wav',
            expectedSizeBytes: 640000,
            expectedDurationMs: 20000,
            status: 'PENDING',
          }),
        }),
      );
    });

    it('rejects invalid exercise with NotFoundException', async () => {
      (
        mockPrisma.speakingExercise.findUnique as jest.Mock
      ).mockResolvedValueOnce(null);

      await expect(
        service.createUploadIntent(999, 10, validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects unsupported MIME type with BadRequestException', async () => {
      const badMimeDto = { ...validDto, contentType: 'image/png' };
      await expect(
        service.createUploadIntent(1, 10, badMimeDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects oversized declared file (>10MB) with BadRequestException', async () => {
      const oversizedDto = { ...validDto, sizeBytes: 11 * 1024 * 1024 };
      await expect(
        service.createUploadIntent(1, 10, oversizedDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid duration (<300ms or >45s) with BadRequestException', async () => {
      await expect(
        service.createUploadIntent(1, 10, { ...validDto, durationMs: 100 }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createUploadIntent(1, 10, { ...validDto, durationMs: 50000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces daily speaking quota before generating intent', async () => {
      (mockPrisma.speakingSubmission.count as jest.Mock).mockResolvedValueOnce(
        10,
      ); // reached limit

      await expect(service.createUploadIntent(1, 10, validDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockUploadService.getPresignedUploadUrl).not.toHaveBeenCalled();
    });

    it('returns existing intent if duplicate idempotencyKey is in flight', async () => {
      const existingIntent = {
        id: 'existing-intent-id',
        userId: 10,
        exerciseId: 1,
        objectKey: 'speaking/pending/10/existing.wav',
        expectedContentType: 'audio/wav',
        expectedSizeBytes: 640000,
        expectedDurationMs: 20000,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 300 * 1000), // still valid
      };
      (
        mockPrisma.speakingUploadIntent.findUnique as jest.Mock
      ).mockResolvedValueOnce(existingIntent);

      const result = await service.createUploadIntent(1, 10, validDto);

      expect(result.uploadIntentId).toBe('existing-intent-id');
      expect(result.objectKey).toBe('speaking/pending/10/existing.wav');
      expect(mockPrisma.speakingUploadIntent.create).not.toHaveBeenCalled();
    });
  });

  describe('Step C: finalizeUpload', () => {
    const validPendingIntent = {
      id: 'intent-uuid-123',
      userId: 10,
      exerciseId: 1,
      objectKey: 'speaking/pending/10/intent-uuid-123.wav',
      expectedContentType: 'audio/wav',
      expectedSizeBytes: 640000,
      expectedDurationMs: 20000,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 300 * 1000),
      submissionId: null,
      submission: null,
    };

    it('enforces ownership: rejects other user with ForbiddenException (IDOR defense)', async () => {
      (
        mockPrisma.speakingUploadIntent.findUnique as jest.Mock
      ).mockResolvedValueOnce(validPendingIntent);

      await expect(
        service.finalizeUpload('intent-uuid-123', 99), // User 99 != 10
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects expired intent with BadRequestException', async () => {
      const expiredIntent = {
        ...validPendingIntent,
        expiresAt: new Date(Date.now() - 1000), // expired in past
      };
      (
        mockPrisma.speakingUploadIntent.findUnique as jest.Mock
      ).mockResolvedValueOnce(expiredIntent);

      await expect(
        service.finalizeUpload('intent-uuid-123', 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if audio was not uploaded to R2 (headObject returns null)', async () => {
      (
        mockPrisma.speakingUploadIntent.findUnique as jest.Mock
      ).mockResolvedValueOnce(validPendingIntent);
      (mockUploadService.headObject as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        service.finalizeUpload('intent-uuid-123', 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects and purges if object size in R2 exceeds 10MB', async () => {
      (
        mockPrisma.speakingUploadIntent.findUnique as jest.Mock
      ).mockResolvedValueOnce(validPendingIntent);
      (mockUploadService.headObject as jest.Mock).mockResolvedValueOnce({
        contentLength: 12 * 1024 * 1024, // 12 MB
        contentType: 'audio/wav',
      });

      await expect(
        service.finalizeUpload('intent-uuid-123', 10),
      ).rejects.toThrow(BadRequestException);

      expect(mockUploadService.deleteFile).toHaveBeenCalledWith(
        'speaking/pending/10/intent-uuid-123.wav',
      );
      expect(mockPrisma.speakingUploadIntent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'INVALID' },
        }),
      );
    });

    it('does not delete an invalid object when the finalization token is stale', async () => {
      (
        mockPrisma.speakingUploadIntent.findUnique as jest.Mock
      ).mockResolvedValueOnce(validPendingIntent);
      (mockUploadService.headObject as jest.Mock).mockResolvedValueOnce({
        contentLength: 12 * 1024 * 1024,
        contentType: 'audio/wav',
      });
      (
        mockPrisma.speakingUploadIntent.updateMany as jest.Mock
      ).mockResolvedValueOnce({
        count: 1,
      }); // claim
      (
        mockPrisma.speakingUploadIntent.updateMany as jest.Mock
      ).mockResolvedValueOnce({
        count: 0,
      }); // stale invalidation token

      await expect(
        service.finalizeUpload('intent-uuid-123', 10),
      ).rejects.toThrow(BadRequestException);

      expect(mockUploadService.deleteFile).not.toHaveBeenCalled();
    });

    it('rejects if actual R2 size differs from declared size (exact size requirement)', async () => {
      (
        mockPrisma.speakingUploadIntent.findUnique as jest.Mock
      ).mockResolvedValueOnce(validPendingIntent);
      (mockUploadService.headObject as jest.Mock).mockResolvedValueOnce({
        contentLength: 640001, // 1 byte larger than 640000
        contentType: 'audio/wav',
      });

      await expect(
        service.finalizeUpload('intent-uuid-123', 10),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully finalizes upload: creates submission, marks FINALIZED, and enqueues BullMQ job', async () => {
      const origMode = process.env.SPEAKING_PIPELINE_MODE;
      try {
        process.env.SPEAKING_PIPELINE_MODE = 'bullmq';

        (
          mockPrisma.speakingUploadIntent.findUnique as jest.Mock
        ).mockResolvedValueOnce(validPendingIntent);

        const result = await service.finalizeUpload(
          'intent-uuid-123',
          10,
          'trace-fin-1',
        );

        expect(result.submissionId).toBe(101);
        expect(result.status).toBe('PENDING');
        expect(result.pollUrl).toBe('/speaking/submissions/101');
        expect(result.traceId).toBe('trace-fin-1');

        // Verified DB creation
        expect(mockPrisma.speakingSubmission.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: 10,
              exerciseId: 1,
              audioKey: 'speaking/pending/10/intent-uuid-123.wav',
              status: 'PENDING',
            }),
          }),
        );

        // Verified intent updated to FINALIZED via updateMany with token fencing
        expect(mockPrisma.speakingUploadIntent.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'FINALIZED',
              submissionId: 101,
            }),
          }),
        );

        // Verified BullMQ job enqueued
        expect(mockQueueService.enqueueSubmission).toHaveBeenCalledWith(
          101,
          'trace-fin-1',
        );
      } finally {
        process.env.SPEAKING_PIPELINE_MODE = origMode;
      }
    });

    it('duplicate finalize returns original submission idempotently without creating another', async () => {
      const finalizedIntent = {
        ...validPendingIntent,
        status: 'FINALIZED',
        submissionId: 101,
        submission: {
          id: 101,
          status: 'COMPLETED',
          submittedAt: new Date('2026-09-30T10:00:00.000Z'),
        },
      };
      (
        mockPrisma.speakingUploadIntent.findUnique as jest.Mock
      ).mockResolvedValueOnce(finalizedIntent);

      const result = await service.finalizeUpload('intent-uuid-123', 10);

      expect(result.submissionId).toBe(101);
      expect(result.status).toBe('COMPLETED');
      expect(mockPrisma.speakingSubmission.create).not.toHaveBeenCalled();
      expect(mockUploadService.headObject).not.toHaveBeenCalled();
    });

    it('retains PENDING state and returns 202 if BullMQ enqueue fails, allowing reconciliation recovery', async () => {
      const origMode = process.env.SPEAKING_PIPELINE_MODE;
      try {
        process.env.SPEAKING_PIPELINE_MODE = 'bullmq';
        (
          mockPrisma.speakingUploadIntent.findUnique as jest.Mock
        ).mockResolvedValueOnce(validPendingIntent);

        (mockQueueService.enqueueSubmission as jest.Mock).mockRejectedValueOnce(
          new Error('Redis connection failed'),
        );

        const result = await service.finalizeUpload(
          'intent-uuid-123',
          10,
          'trace-err',
        );

        expect(result.submissionId).toBe(101);
        expect(result.status).toBe('PENDING');
        // Does not throw — returns 202 for reconciliation scheduler
      } finally {
        process.env.SPEAKING_PIPELINE_MODE = origMode;
      }
    });

    it('does not roll a stale FINALIZING token back to PENDING after a transient transaction failure', async () => {
      const tokenBIntent = {
        ...validPendingIntent,
        status: 'FINALIZING',
        finalizationToken: 'token-b',
        submissionId: null,
      };
      (mockPrisma.speakingUploadIntent.findUnique as jest.Mock)
        .mockResolvedValueOnce(validPendingIntent)
        .mockResolvedValueOnce(tokenBIntent);
      (mockPrisma.$transaction as jest.Mock).mockRejectedValueOnce(
        new Error('temporary database outage'),
      );

      await expect(
        service.finalizeUpload('intent-uuid-123', 10),
      ).rejects.toThrow('temporary database outage');

      expect(
        mockPrisma.speakingUploadIntent.updateMany,
      ).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
    });

    it('does not enqueue or persist a submission when the finalization token is superseded during the transaction', async () => {
      (
        mockPrisma.speakingUploadIntent.findUnique as jest.Mock
      ).mockResolvedValueOnce(validPendingIntent);
      (
        mockPrisma.speakingUploadIntent.updateMany as jest.Mock
      ).mockResolvedValueOnce({
        count: 1,
      }); // claim
      (
        mockPrisma.speakingUploadIntent.updateMany as jest.Mock
      ).mockResolvedValueOnce({
        count: 0,
      }); // token B owns the intent inside the transaction

      await expect(
        service.finalizeUpload('intent-uuid-123', 10),
      ).rejects.toThrow(ConflictException);

      expect(mockQueueService.enqueueSubmission).not.toHaveBeenCalled();
      expect(mockPrisma.speakingUploadIntent.updateMany).toHaveBeenCalledTimes(
        2,
      );
    });

    it('rejects reusing the same idempotency key with conflicting metadata (ConflictException)', async () => {
      const existingIntent = {
        id: 'existing-id',
        exerciseId: 1,
        expectedContentType: 'audio/wav',
        expectedSizeBytes: 640000,
        expectedDurationMs: 20000,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 300000),
      };
      (
        mockPrisma.speakingUploadIntent.findUnique as jest.Mock
      ).mockResolvedValueOnce(existingIntent);

      const conflictingDto = {
        contentType: 'audio/wav',
        sizeBytes: 800000, // Different size!
        durationMs: 25000,
        idempotencyKey: 'idemp-intent-001',
      };

      await expect(
        service.createUploadIntent(1, 10, conflictingDto),
      ).rejects.toThrow(ConflictException);
    });

    it('enforces active intent limits: rejects if user has >= 3 unexpired active intents', async () => {
      (
        mockPrisma.speakingUploadIntent.count as jest.Mock
      ).mockResolvedValueOnce(3);

      await expect(
        service.createUploadIntent(1, 10, {
          contentType: 'audio/wav',
          sizeBytes: 640000,
          durationMs: 20000,
          idempotencyKey: 'new-idemp-key',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
