import { SpeakingWorkerService } from './speaking-worker.service';
import { createWavBuffer } from './speaking-audio-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

type MockFn = jest.Mock;
type MockPrisma = {
  $queryRaw: MockFn;
  speakingSubmission: {
    findUnique: MockFn;
    update: MockFn;
    updateMany: MockFn;
  };
};

describe('SpeakingWorkerService - Durable Processing & Failure Semantics', () => {
  let worker: SpeakingWorkerService;
  let mockPrisma: MockPrisma;
  let mockAiService: { assessPronunciation: MockFn };
  let mockUploadService: { downloadFileBuffer: MockFn };
  let mockEventEmitter: { emitAsync: MockFn };

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn(),
      speakingSubmission: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    mockAiService = {
      assessPronunciation: jest.fn(),
    };
    mockUploadService = {
      downloadFileBuffer: jest.fn(),
    };
    mockEventEmitter = {
      emitAsync: jest.fn(),
    };

    worker = new SpeakingWorkerService(
      mockPrisma as unknown as PrismaService,
      mockAiService as unknown as AiService,
      mockUploadService as unknown as UploadService,
      mockEventEmitter as unknown as EventEmitter2,
    );
  });

  describe('Lease Recovery', () => {
    it('recovers stuck PROCESSING leases: re-queues when attemptCount < MAX_ATTEMPTS and marks FAILED when >= MAX_ATTEMPTS', async () => {
      await worker.recoverStuckLeases();

      expect(mockPrisma.speakingSubmission.updateMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PROCESSING',
            attemptCount: { gte: 4 },
          }),
          data: expect.objectContaining({
            status: 'FAILED',
            lastErrorCode: 'LEASE_TIMEOUT_EXCEEDED',
          }),
        }),
      );

      expect(mockPrisma.speakingSubmission.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PROCESSING',
            attemptCount: { lt: 4 },
          }),
          data: expect.objectContaining({
            status: 'PENDING',
          }),
        }),
      );
    });
  });

  describe('Permanent Failure (Invalid Audio Bytes)', () => {
    it('marks submission as FAILED immediately without retry when audio bytes are invalid', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 10,
        audioKey: 'speaking_audio/corrupt.wav',
        audioMimeType: 'audio/wav',
        attemptCount: 1,
        exercise: { targetText: 'Hello' },
      });

      // Corrupt buffer (not RIFF/WAVE)
      mockUploadService.downloadFileBuffer.mockResolvedValueOnce(
        Buffer.from('CORRUPTED_NON_WAV_BYTES_12345'),
      );

      await worker.processSubmission(10);

      expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: expect.objectContaining({
          status: 'FAILED',
          overallScore: null,
          lastErrorCode: 'INVALID_AUDIO',
          nextAttemptAt: null,
        }),
      });
      expect(mockAiService.assessPronunciation).not.toHaveBeenCalled();
      expect(mockEventEmitter.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('Transient Provider Failure & Backoff Retries', () => {
    const validWav = createWavBuffer({ durationSeconds: 1 });

    it('schedules retry with exponential backoff on transient provider timeout', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 20,
        audioKey: 'speaking_audio/valid.wav',
        audioMimeType: 'audio/wav',
        attemptCount: 1, // First attempt
        exercise: { targetText: 'Good morning' },
      });
      mockUploadService.downloadFileBuffer.mockResolvedValueOnce(validWav);

      const timeoutErr: any = new Error('Azure timed out');
      timeoutErr.code = 'PROVIDER_TIMEOUT';
      mockAiService.assessPronunciation.mockRejectedValueOnce(timeoutErr);

      await worker.processSubmission(20);

      expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith({
        where: { id: 20 },
        data: expect.objectContaining({
          status: 'PENDING',
          lastErrorCode: 'PROVIDER_TIMEOUT',
          nextAttemptAt: expect.any(Date),
        }),
      });
      expect(mockEventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('marks submission as FAILED when attemptCount reaches MAX_ATTEMPTS without storing fake score', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 30,
        audioKey: 'speaking_audio/valid.wav',
        audioMimeType: 'audio/wav',
        attemptCount: 4, // Reached max
        exercise: { targetText: 'Good morning' },
      });
      mockUploadService.downloadFileBuffer.mockResolvedValueOnce(validWav);

      const providerErr: any = new Error('Service Unavailable');
      providerErr.code = 'PROVIDER_UNAVAILABLE';
      mockAiService.assessPronunciation.mockRejectedValueOnce(providerErr);

      await worker.processSubmission(30);

      expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith({
        where: { id: 30 },
        data: expect.objectContaining({
          status: 'FAILED',
          overallScore: null, // Zero fake scores!
          lastErrorCode: 'PROVIDER_UNAVAILABLE',
          nextAttemptAt: null,
        }),
      });
      expect(mockEventEmitter.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('Valid Assessment & Gamification Idempotency', () => {
    const validWav = createWavBuffer({ durationSeconds: 1 });

    it('persists byte-level silent audio as COMPLETED NO_SPEECH without calling the provider', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 45,
        audioKey: 'speaking_audio/silent.wav',
        audioMimeType: 'audio/wav',
        attemptCount: 1,
        exercise: { targetText: 'Hello world' },
      });
      mockUploadService.downloadFileBuffer.mockResolvedValueOnce(
        createWavBuffer({ durationSeconds: 1, silent: true }),
      );

      await worker.processSubmission(45);

      expect(mockAiService.assessPronunciation).not.toHaveBeenCalled();
      expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith({
        where: { id: 45 },
        data: expect.objectContaining({
          status: 'COMPLETED',
          overallScore: null,
          lastErrorCode: 'NO_SPEECH',
        }),
      });
    });

    it('processes valid speech successfully, updates COMPLETED, and emits gamification reward once', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 40,
        userId: 7,
        exerciseId: 2,
        audioKey: 'speaking_audio/valid.wav',
        audioMimeType: 'audio/wav',
        attemptCount: 1,
        rewardGrantedAt: null, // Not yet granted
        exercise: { targetText: 'Hello world' },
      });
      mockUploadService.downloadFileBuffer.mockResolvedValueOnce(validWav);

      mockAiService.assessPronunciation.mockResolvedValueOnce({
        overallScore: 8.5,
        clarity: 'Good',
        transcript: 'Hello world',
        accuracyScore: 85,
        fluencyScore: 88,
        completenessScore: 100,
        isSilentOrNoSpeech: false,
      });

      mockPrisma.speakingSubmission.update.mockResolvedValueOnce({
        id: 40,
        userId: 7,
        exerciseId: 2,
        overallScore: 8.5,
        rewardGrantedAt: null,
      });
      mockPrisma.speakingSubmission.updateMany.mockResolvedValueOnce({
        count: 1,
      });

      await worker.processSubmission(40);

      expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 40 },
          data: expect.objectContaining({
            status: 'COMPLETED',
            overallScore: 8.5,
            transcript: 'Hello world',
          }),
        }),
      );

      // Verify gamification event was emitted
      expect(mockEventEmitter.emitAsync).toHaveBeenCalledWith(
        'speaking.submitted',
        {
          submissionId: 40,
          userId: 7,
          exerciseId: 2,
          overallScore: 8.5,
          isSilentOrNoSpeech: false,
        },
      );
    });

    it('stores NO_SPEECH as a completed attempt without manufacturing a numeric score', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 50,
        userId: 7,
        exerciseId: 2,
        audioKey: 'speaking_audio/valid.wav',
        attemptCount: 1,
        rewardGrantedAt: null,
        exercise: { targetText: 'Hello world' },
      });
      mockUploadService.downloadFileBuffer.mockResolvedValueOnce(validWav);

      mockAiService.assessPronunciation.mockResolvedValueOnce({
        overallScore: null,
        clarity: 'Poor',
        transcript: '',
        isSilentOrNoSpeech: true,
        errorCode: 'NO_SPEECH',
      });

      mockPrisma.speakingSubmission.update.mockResolvedValueOnce({
        id: 50,
        userId: 7,
        exerciseId: 2,
        overallScore: 0,
        rewardGrantedAt: null,
      });

      await worker.processSubmission(50);

      expect(mockPrisma.speakingSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 50 },
          data: expect.objectContaining({
            status: 'COMPLETED',
            overallScore: null,
            lastErrorCode: 'NO_SPEECH',
          }),
        }),
      );
      // Silent speech must NEVER emit gamification points
      expect(mockEventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('does NOT re-emit gamification reward if rewardGrantedAt was already set', async () => {
      mockPrisma.speakingSubmission.findUnique.mockResolvedValueOnce({
        id: 60,
        userId: 7,
        exerciseId: 2,
        audioKey: 'speaking_audio/valid.wav',
        attemptCount: 1,
        rewardGrantedAt: new Date(), // Already granted previously
        exercise: { targetText: 'Hello world' },
      });
      mockUploadService.downloadFileBuffer.mockResolvedValueOnce(validWav);

      mockAiService.assessPronunciation.mockResolvedValueOnce({
        overallScore: 9.0,
        isSilentOrNoSpeech: false,
      });

      mockPrisma.speakingSubmission.update.mockResolvedValueOnce({
        id: 60,
        rewardGrantedAt: new Date(),
      });

      await worker.processSubmission(60);

      expect(mockEventEmitter.emitAsync).not.toHaveBeenCalled();
    });
  });
});
