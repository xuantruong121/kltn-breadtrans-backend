import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { UploadService } from '../upload/upload.service';
import { SpeakingContentAccessService } from './speaking-content-access.service';
import { SpeakingService } from './speaking.service';

/**
 * "Nghe thử" in the Speaking CMS plays the clip the learner endpoint returns
 * (QA 2026-11-22). A B1+ draft clip must come back signed to the admin.
 */
describe('Speaking reference audio in the admin preview', () => {
  const exerciseIn = (level: string, audioUrl: string) => ({
    id: 203,
    title: 'Read Aloud B1 — Meeting Notice',
    targetText: 'The meeting starts at nine.',
    taskType: 'READ_ALOUD',
    order: 1,
    imageUrl: null,
    stimulusId: null,
    stimulus: null,
    audioUrl,
    isPremiumContent: false,
    difficulty: 'INTERMEDIATE',
    publicationStatus: 'DRAFT',
    practiceSetId: 'speaking-x',
    practiceSet: {
      id: 'speaking-x',
      scope: 'SKILL_PRACTICE',
      level,
      publicationStatus: 'DRAFT',
    },
  });

  const build = (exercise: ReturnType<typeof exerciseIn>) => {
    const prisma = {
      speakingExercise: { findUnique: jest.fn().mockResolvedValue(exercise) },
    };
    const upload = {
      getPrivatePresignedDownloadUrl: jest
        .fn()
        .mockImplementation((key: string) => `https://signed/${key}`),
    };
    const access = new SpeakingContentAccessService({
      effectivePlanCode: jest.fn().mockResolvedValue('FREE'),
    } as unknown as SubscriptionService);
    const service = new SpeakingService(
      prisma as unknown as PrismaService,
      {} as AiService,
      upload as unknown as UploadService,
      {} as any,
      undefined,
      undefined,
      undefined,
      access,
    );
    return { service, upload };
  };

  it('signs the private clip of an INTERMEDIATE draft for an admin', async () => {
    const key = 'premium/speaking/reference/203.r1763800000000.mp3';
    const { service, upload } = build(exerciseIn('INTERMEDIATE', key));
    const result: any = await service.findExerciseById(203, 1, Role.ADMIN);
    expect(result.isPremiumContent).toBe(true);
    expect(result.audioUrl).toBe(`https://signed/${key}`);
    expect(upload.getPrivatePresignedDownloadUrl).toHaveBeenCalledWith(
      key,
      300,
    );
  });

  it('never hands out a public clip on paid content, which is why the CMS stores INTERMEDIATE+ privately', async () => {
    const { service } = build(
      exerciseIn(
        'INTERMEDIATE',
        'https://pub/catalog/speaking/reference/203.r1763800000000.mp3',
      ),
    );
    const result: any = await service.findExerciseById(203, 1, Role.ADMIN);
    expect(result.audioUrl).toBeNull();
  });

  it('plays the public clip of a free STARTER draft as it is', async () => {
    const url = 'https://pub/catalog/speaking/reference/203.r1763800000000.mp3';
    const { service, upload } = build(exerciseIn('STARTER', url));
    const result: any = await service.findExerciseById(203, 1, Role.ADMIN);
    expect(result.isPremiumContent).toBe(false);
    expect(result.audioUrl).toBe(url);
    expect(upload.getPrivatePresignedDownloadUrl).not.toHaveBeenCalled();
  });
});
