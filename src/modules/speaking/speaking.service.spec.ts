import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SpeakingService } from './speaking.service';
import { createWavBuffer } from './speaking-audio-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';

type MockFn = jest.Mock;
type MockPrisma = {
  $queryRaw: MockFn;
  $transaction: MockFn;
  speakingExercise: { findUnique: MockFn; findMany: MockFn };
  speakingSubmission: {
    findUnique: MockFn;
    findMany: MockFn;
    count: MockFn;
    create: MockFn;
  };
  vocabWord: { findFirst: MockFn };
};

describe('SpeakingService - Durable Submissions & Security', () => {
  let service: SpeakingService;
  let mockPrisma: MockPrisma;
  let mockAiService: {
    assessPronunciation: MockFn;
    evaluateSpeakingPart3To5: MockFn;
  };
  let mockUploadService: {
    uploadRawBuffer: MockFn;
    deleteFile: MockFn;
    getPresignedDownloadUrl: MockFn;
  };
  let mockWorker: { triggerProcessing: MockFn };

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn((callback: (tx: MockPrisma) => unknown) =>
        Promise.resolve(callback(mockPrisma)),
      ),
      speakingExercise: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      speakingSubmission: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
      vocabWord: {
        findFirst: jest.fn(),
      },
    };
    mockAiService = {
      assessPronunciation: jest.fn(),
      evaluateSpeakingPart3To5: jest.fn(),
    };
    mockUploadService = {
      uploadRawBuffer: jest.fn().mockResolvedValue({
        key: 'speaking_audio/test-123.wav',
        url: 'https://r2.example.com/speaking_audio/test-123.wav',
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      getPresignedDownloadUrl: jest
        .fn()
        .mockResolvedValue('https://signed-r2.example.com/audio'),
    };
    mockWorker = {
      triggerProcessing: jest.fn(),
    };

    service = new SpeakingService(
      mockPrisma as unknown as PrismaService,
      mockAiService as unknown as AiService,
      mockUploadService as unknown as UploadService,
      mockWorker as unknown as import('./speaking-worker.service').SpeakingWorkerService,
    );
  });

  describe('submitAudio', () => {
    const validWav = createWavBuffer({ durationSeconds: 1 });
    const mockFile: Express.Multer.File = {
      buffer: validWav,
      mimetype: 'audio/wav',
      originalname: 'recording.wav',
      fieldname: 'audio',
      encoding: '7bit',
      size: validWav.length,
      destination: '',
      filename: '',
      path: '',
      stream: null as any,
    };

    it('rejects missing Idempotency-Key with 400 BadRequestException', async () => {
      await expect(
        service.submitAudio(1, 10, mockFile, undefined),
      ).rejects.toThrow(BadRequestException);
      await expect(service.submitAudio(1, 10, mockFile, '')).rejects.toThrow(
        'Header "Idempotency-Key" is required and must be a valid non-empty string',
      );
    });

    it('returns existing submission on duplicate Idempotency-Key without creating a new record', async () => {
      const existingDate = new Date();
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 99,
        status: 'PENDING',
        submittedAt: existingDate,
      });

      const response = await service.submitAudio(
        1,
        10,
        mockFile,
        'idemp-key-123',
      );

      expect(response).toEqual({
        submissionId: 99,
        status: 'PENDING',
        pollUrl: '/speaking/submissions/99',
        acceptedAt: existingDate.toISOString(),
      });
      expect(mockPrisma.speakingSubmission.create).not.toHaveBeenCalled();
      expect(mockUploadService.uploadRawBuffer).not.toHaveBeenCalled();
    });

    it('creates PENDING submission and returns 202 Accepted on valid new submission', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce(null);
      mockPrisma.speakingSubmission.count.mockResolvedValueOnce(0); // within daily limit
      mockPrisma.speakingExercise.findUnique.mockResolvedValueOnce({
        id: 1,
        title: 'Morning Meeting',
        targetText: 'Good morning everyone.',
      });

      const submittedAt = new Date();
      mockPrisma.speakingSubmission.create.mockResolvedValueOnce({
        id: 101,
        exerciseId: 1,
        userId: 10,
        status: 'PENDING',
        submittedAt,
      });

      const response = await service.submitAudio(
        1,
        10,
        mockFile,
        'idemp-key-fresh',
      );

      expect(response).toEqual({
        submissionId: 101,
        status: 'PENDING',
        pollUrl: '/speaking/submissions/101',
        acceptedAt: submittedAt.toISOString(),
      });
      expect(mockUploadService.uploadRawBuffer).toHaveBeenCalled();
      expect(mockWorker.triggerProcessing).toHaveBeenCalled();
    });

    it('rejects when daily limit is exceeded', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce(null);
      mockPrisma.speakingExercise.findUnique.mockResolvedValueOnce({ id: 1 });
      mockPrisma.speakingSubmission.count.mockResolvedValueOnce(10); // at limit

      await expect(
        service.submitAudio(1, 10, mockFile, 'idemp-key-limit'),
      ).rejects.toThrow('Bạn đã đạt giới hạn chấm điểm phát âm hôm nay');
    });
  });

  describe('getSubmission & Ownership Protection', () => {
    it('throws NotFoundException if submission does not exist', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.getSubmission(999, { id: 10, role: 'STUDENT' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if another student attempts to access submission', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 50,
        userId: 20, // Different user
      });

      await expect(
        service.getSubmission(50, { id: 10, role: 'STUDENT' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows owner to access submission and provides sanitized signed audio URL', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 50,
        userId: 10,
        exerciseId: 1,
        status: 'COMPLETED',
        overallScore: 8.5,
        audioKey: 'speaking_audio/rec.wav',
        audioUrl: 'https://r2.example.com/speaking_audio/rec.wav',
        submittedAt: new Date(),
        exercise: { title: 'Exercise 1' },
      });

      const result = await service.getSubmission(50, {
        id: 10,
        role: 'STUDENT',
      });
      expect(result.id).toBe(50);
      expect(result.audioUrl).toBe('https://signed-r2.example.com/audio');
      expect(mockUploadService.getPresignedDownloadUrl).toHaveBeenCalledWith(
        'speaking_audio/rec.wav',
        3600,
      );
    });

    it('allows administrator to access any user submission', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 50,
        userId: 20,
        exerciseId: 1,
        status: 'COMPLETED',
        audioKey: 'speaking_audio/rec.wav',
      });

      const result = await service.getSubmission(50, { id: 1, role: 'ADMIN' });
      expect(result.id).toBe(50);
    });
  });

  describe('Neural TTS & SSML Escaping', () => {
    it('escapes XML/SSML characters correctly', () => {
      const escaped = service.escapeSsml('Tom & Jerry < "good" > \'day\'');
      expect(escaped).toBe(
        'Tom &amp; Jerry &lt; &quot;good&quot; &gt; &apos;day&apos;',
      );
    });

    it('rejects invalid accent', async () => {
      await expect(
        service.generateTts('Hello', 'AU' as any, 1),
      ).rejects.toThrow('Invalid accent');
    });

    it('rejects invalid speed rate', async () => {
      await expect(
        service.generateTts('Hello', 'US', 2.0 as any),
      ).rejects.toThrow('Invalid playback rate');
    });

    it('rejects empty text or text longer than 500 characters', async () => {
      await expect(service.generateTts('', 'US', 1)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.generateTts('a'.repeat(501), 'US', 1),
      ).rejects.toThrow('Text exceeds maximum length of 500 characters');
    });

    it('fails closed when Azure TTS credentials are unavailable', async () => {
      const previousKey = process.env.AZURE_SPEECH_KEY;
      const previousRegion = process.env.AZURE_SPEECH_REGION;
      delete process.env.AZURE_SPEECH_KEY;
      delete process.env.AZURE_SPEECH_REGION;

      try {
        await expect(service.generateTts('Hello', 'US', 1)).rejects.toThrow(
          ServiceUnavailableException,
        );
      } finally {
        if (previousKey) process.env.AZURE_SPEECH_KEY = previousKey;
        if (previousRegion) process.env.AZURE_SPEECH_REGION = previousRegion;
      }
    });
  });
});
