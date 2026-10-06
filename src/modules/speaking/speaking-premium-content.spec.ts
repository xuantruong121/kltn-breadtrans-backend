import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { UploadService } from '../upload/upload.service';
import { SpeakingContentAccessService } from './speaking-content-access.service';
import { SpeakingService } from './speaking.service';

describe('Speaking premium content boundary', () => {
  const exercise = {
    id: 1,
    title: 'Premium prompt',
    targetText: 'Do not leak this text',
    imageUrl: null,
    audioUrl: 'premium/speaking/exercise-1.mp3',
    isPremiumContent: true,
    difficulty: 'BEGINNER',
    category: 'GENERAL',
    createdAt: new Date(),
  };

  const access = {
    resolveMany: jest.fn(),
    resolve: jest.fn(),
    assertAccess: jest.fn(),
  } as unknown as SpeakingContentAccessService;
  const prisma = {
    speakingExercise: { findMany: jest.fn(), findUnique: jest.fn() },
    speakingSubmission: { findMany: jest.fn(), findUnique: jest.fn() },
  };
  const upload = { getPrivatePresignedDownloadUrl: jest.fn() };

  let service: SpeakingService;

  beforeEach(() => {
    jest.clearAllMocks();
    (access.resolveMany as jest.Mock).mockResolvedValue(
      new Map([[1, { isPremiumContent: true, isLocked: true }]]),
    );
    (access.resolve as jest.Mock).mockResolvedValue({
      isPremiumContent: true,
      isLocked: true,
    });
    (access.assertAccess as unknown as jest.Mock).mockRejectedValue(
      new ForbiddenException({
        error: {
          code: 'FEATURE_NOT_INCLUDED',
          featureKey: 'PREMIUM_SPEAKING_CONTENT',
        },
      }),
    );
    prisma.speakingExercise.findMany.mockResolvedValue([exercise]);
    prisma.speakingExercise.findUnique.mockResolvedValue(exercise);
    prisma.speakingSubmission.findMany.mockResolvedValue([]);
    prisma.speakingSubmission.findUnique.mockResolvedValue(null);
    service = new SpeakingService(
      prisma as unknown as PrismaService,
      {} as AiService,
      upload as unknown as UploadService,
      {} as any,
      undefined,
      undefined,
      undefined,
      access,
    );
  });

  it('returns locked safe metadata without target text or playable audio', async () => {
    const result = await service.findAllExercises(undefined, 7, Role.STUDENT);
    expect(result[0]).toMatchObject({
      id: 1,
      isPremiumContent: true,
      isLocked: true,
    });
    expect(result[0]).not.toHaveProperty('targetText');
    expect(result[0]).not.toHaveProperty('audioUrl');
  });

  it('denies premium detail before serializing protected content', async () => {
    await expect(
      service.findExerciseById(1, 7, Role.STUDENT),
    ).rejects.toMatchObject({
      response: { error: { code: 'FEATURE_NOT_INCLUDED' } },
    });
    expect(access.assertAccess).toHaveBeenCalledWith(exercise, 7, Role.STUDENT);
  });

  it('closes the legacy submit bypass before provider work', async () => {
    const audio = {
      buffer: Buffer.from('audio'),
      mimetype: 'audio/wav',
    } as Express.Multer.File;
    await expect(
      service.submitAudio(
        1,
        7,
        audio,
        'idempotency-key',
        undefined,
        Role.STUDENT,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'FEATURE_NOT_INCLUDED' } },
    });
    expect(access.assertAccess).toHaveBeenCalledWith(exercise, 7, Role.STUDENT);
  });
});
