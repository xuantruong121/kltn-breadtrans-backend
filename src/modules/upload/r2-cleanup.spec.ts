import { R2CleanupService } from './r2-cleanup.service';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from './r2.service';

describe('R2CleanupService - Phase 2 Orphan Upload Intent Cleanup', () => {
  let service: R2CleanupService;
  let mockPrisma: any;
  let mockR2Service: any;

  beforeEach(() => {
    mockPrisma = {
      speakingSubmission: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      speakingUploadIntent: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockR2Service = {
      objectExists: jest.fn().mockResolvedValue(true),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };

    service = new R2CleanupService(
      mockPrisma as PrismaService,
      mockR2Service as R2Service,
    );
  });

  it('inspects expired unfinalized intents and purges orphan objects from R2', async () => {
    const expiredIntents = [
      {
        id: 'intent-1',
        objectKey: 'speaking/pending/10/intent-1.wav',
        status: 'PENDING',
        submissionId: null,
      },
      {
        id: 'intent-2',
        objectKey: 'speaking/pending/11/intent-2.wav',
        status: 'INVALID',
        submissionId: null,
      },
    ];

    (mockPrisma.speakingUploadIntent.findMany as jest.Mock).mockImplementation(
      (args: { where?: { status?: string } }) => {
        if (args?.where?.status === 'FINALIZING') return Promise.resolve([]);
        return Promise.resolve(expiredIntents);
      },
    );

    const counts = await service.cleanupOrphanUploadIntents();

    expect(counts.intentsInspected).toBe(2);
    expect(counts.objectsDeleted).toBe(2);
    expect(counts.recordsExpired).toBe(1); // intent-1 is PENDING -> EXPIRED; intent-2 was already INVALID
    expect(counts.failures).toBe(0);

    expect(mockR2Service.deleteFile).toHaveBeenCalledWith(
      'speaking/pending/10/intent-1.wav',
    );
    expect(mockR2Service.deleteFile).toHaveBeenCalledWith(
      'speaking/pending/11/intent-2.wav',
    );
    expect(mockPrisma.speakingUploadIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'intent-1', status: 'PENDING' }),
        data: { status: 'EXPIRED' },
      }),
    );
  });

  it('CRITICAL INVARIANT: never deletes audio belonging to a valid finalized submission', async () => {
    const intentWithSubmission = [
      {
        id: 'intent-valid',
        objectKey: 'speaking/pending/10/finalized.wav',
        status: 'PENDING',
        submissionId: 999, // Has submission linked
      },
    ];

    (mockPrisma.speakingUploadIntent.findMany as jest.Mock).mockImplementation(
      (args: { where?: { status?: string } }) => {
        if (args?.where?.status === 'FINALIZING') return Promise.resolve([]);
        return Promise.resolve(intentWithSubmission);
      },
    );

    const counts = await service.cleanupOrphanUploadIntents();

    expect(counts.intentsInspected).toBe(1);
    expect(counts.objectsDeleted).toBe(0);
    expect(mockR2Service.deleteFile).not.toHaveBeenCalled();
  });

  it('CRITICAL INVARIANT: protects audio if a SpeakingSubmission references the objectKey even without intent submissionId link', async () => {
    const unlinkedIntent = [
      {
        id: 'intent-orphan-key',
        objectKey: 'speaking/pending/10/claimed.wav',
        status: 'PENDING',
        submissionId: null,
      },
    ];

    (mockPrisma.speakingUploadIntent.findMany as jest.Mock).mockImplementation(
      (args: { where?: { status?: string } }) => {
        if (args?.where?.status === 'FINALIZING') return Promise.resolve([]);
        return Promise.resolve(unlinkedIntent);
      },
    );
    // SpeakingSubmission exists with that audioKey!
    (
      mockPrisma.speakingSubmission.findFirst as jest.Mock
    ).mockResolvedValueOnce({ id: 555 });

    const counts = await service.cleanupOrphanUploadIntents();

    expect(counts.intentsInspected).toBe(1);
    expect(counts.objectsDeleted).toBe(0);
    expect(mockR2Service.deleteFile).not.toHaveBeenCalled();
    // Links intent to submission to heal state
    expect(mockPrisma.speakingUploadIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'intent-orphan-key' },
        data: { status: 'FINALIZED', submissionId: 555 },
      }),
    );
  });

  it('safely handles missing objects in R2 without crashing', async () => {
    const missingObjectIntent = [
      {
        id: 'intent-no-obj',
        objectKey: 'speaking/pending/10/never-uploaded.wav',
        status: 'PENDING',
        submissionId: null,
      },
    ];

    (mockPrisma.speakingUploadIntent.findMany as jest.Mock).mockImplementation(
      (args: { where?: { status?: string } }) => {
        if (args?.where?.status === 'FINALIZING') return Promise.resolve([]);
        return Promise.resolve(missingObjectIntent);
      },
    );
    (mockR2Service.objectExists as jest.Mock).mockResolvedValueOnce(false); // never uploaded

    const counts = await service.cleanupOrphanUploadIntents();

    expect(counts.intentsInspected).toBe(1);
    expect(counts.objectsDeleted).toBe(0);
    expect(counts.recordsExpired).toBe(1);
    expect(mockR2Service.deleteFile).not.toHaveBeenCalled();
  });

  it('records failures gracefully and continues processing remaining batch items', async () => {
    const batch = [
      {
        id: 'intent-fail',
        objectKey: 'speaking/pending/10/fail.wav',
        status: 'PENDING',
        submissionId: null,
      },
      {
        id: 'intent-ok',
        objectKey: 'speaking/pending/10/ok.wav',
        status: 'PENDING',
        submissionId: null,
      },
    ];

    (mockPrisma.speakingUploadIntent.findMany as jest.Mock).mockImplementation(
      (args: { where?: { status?: string } }) => {
        if (args?.where?.status === 'FINALIZING') return Promise.resolve([]);
        return Promise.resolve(batch);
      },
    );
    (mockR2Service.objectExists as jest.Mock)
      .mockRejectedValueOnce(new Error('S3 500 Network error'))
      .mockResolvedValueOnce(true);

    const counts = await service.cleanupOrphanUploadIntents();

    expect(counts.intentsInspected).toBe(2);
    expect(counts.failures).toBe(1);
    expect(counts.objectsDeleted).toBe(1);
    expect(counts.recordsExpired).toBe(2);
  });

  it('reconciles stale FINALIZING intents: reverts unexpired to PENDING and reconciles linked to FINALIZED', async () => {
    const staleIntents = [
      {
        id: 'stale-1',
        objectKey: 'speaking/pending/10/stale1.wav',
        status: 'FINALIZING',
        submissionId: 777, // already created submission
        expiresAt: new Date(Date.now() + 60000),
        finalizationToken: 'token-1',
      },
      {
        id: 'stale-2',
        objectKey: 'speaking/pending/10/stale2.wav',
        status: 'FINALIZING',
        submissionId: null, // abandoned before submission, still valid
        expiresAt: new Date(Date.now() + 60000),
        finalizationToken: 'token-2',
      },
    ];

    (mockPrisma.speakingUploadIntent.findMany as jest.Mock).mockImplementation(
      (args: { where?: { status?: string } }) => {
        if (args?.where?.status === 'FINALIZING')
          return Promise.resolve(staleIntents);
        return Promise.resolve([]);
      },
    );

    const counts = await service.cleanupOrphanUploadIntents();

    expect(counts.intentsInspected).toBe(2);
    expect(counts.staleReconciledToFinalized).toBe(1);
    expect(counts.staleRecoveredToPending).toBe(1);
    expect(mockR2Service.deleteFile).not.toHaveBeenCalled();
  });
});
