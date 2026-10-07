import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PlanFeatureKey } from '@prisma/client';
import { VocabService } from './vocab.service';
import { PrismaService } from '../../prisma/prisma.service';

import { EventEmitter2 } from '@nestjs/event-emitter';

describe('VocabService', () => {
  let service: VocabService;

  const topic = (isPro: boolean) => ({
    id: isPro ? 2 : 1,
    title: isPro ? 'Premium topic' : 'Free topic',
    categoryName: '600 TỪ VỰNG TOEIC',
    totalWords: 1,
    isPro,
    iconUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  function createPremiumService(
    hasFeature: boolean,
    premiumTopic = topic(true),
  ) {
    const prisma = {
      vocabTopic: {
        findUnique: jest.fn().mockResolvedValue(premiumTopic),
        findMany: jest.fn().mockResolvedValue([]),
      },
      vocabWord: { findMany: jest.fn().mockResolvedValue([]) },
      userVocabWordProgress: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const subscriptionService = {
      hasFeature: jest.fn().mockResolvedValue(hasFeature),
    };
    const service = new VocabService(
      prisma as never,
      { emitAsync: jest.fn() } as never,
      undefined,
      subscriptionService as never,
    );
    return { service, prisma, subscriptionService };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VocabService,
        { provide: PrismaService, useValue: {} },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
            emitAsync: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<VocabService>(VocabService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTopics', () => {
    it('keeps the speaking system dictionary out of the flashcard catalog', async () => {
      const prisma = (service as any).prisma;
      prisma.vocabTopic = { findMany: jest.fn().mockResolvedValue([]) };

      await service.getTopics();

      expect(prisma.vocabTopic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { categoryName: { not: 'SYSTEM_DICTIONARY' } },
        }),
      );
    });

    it('returns safe locked metadata for premium topics without leaking words', async () => {
      const { service, prisma, subscriptionService } =
        createPremiumService(false);
      prisma.vocabTopic.findMany = jest
        .fn()
        .mockResolvedValue([topic(false), topic(true)]);

      const result = await service.getTopics(7);

      expect(subscriptionService.hasFeature).toHaveBeenCalledWith(
        7,
        PlanFeatureKey.PREMIUM_VOCAB,
      );
      expect(result.topics).toEqual([
        expect.objectContaining({ id: 1, isPro: false, isLocked: false }),
        expect.objectContaining({ id: 2, isPro: true, isLocked: true }),
      ]);
      expect(result.topics[1]).not.toHaveProperty('words');
    });
  });

  describe('premium topic access', () => {
    it('rejects an unauthenticated premium detail request with 401', async () => {
      const { service, prisma } = createPremiumService(false);

      await expect(service.getTopicDetails(2)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.vocabWord.findMany).not.toHaveBeenCalled();
    });

    it('rejects an authenticated user without PREMIUM_VOCAB with a structured 403', async () => {
      const { service, prisma } = createPremiumService(false);

      const error = await service
        .getTopicDetails(2, 7)
        .catch((value: unknown) => value);

      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse();
      expect(response).toMatchObject({
        error: {
          code: 'FEATURE_NOT_INCLUDED',
          featureKey: PlanFeatureKey.PREMIUM_VOCAB,
        },
      });
      expect(prisma.vocabWord.findMany).not.toHaveBeenCalled();
    });

    it('allows premium content when the entitlement is enabled regardless of plan code', async () => {
      const { service, prisma, subscriptionService } =
        createPremiumService(true);
      prisma.vocabWord.findMany.mockResolvedValue([
        {
          id: 20,
          topicId: 2,
          word: 'museum',
          pos: 'noun',
          meaning: 'a museum',
          ipaUs: null,
          ipaUk: null,
          audioUs: null,
          audioUk: null,
          exampleEn: null,
          exampleVi: null,
          collocations: null,
          order: 0,
        },
      ]);

      const result = await service.getTopicDetails(2, 7);

      expect(subscriptionService.hasFeature).toHaveBeenCalledWith(
        7,
        PlanFeatureKey.PREMIUM_VOCAB,
      );
      expect(result.words).toHaveLength(1);
      expect(result.words[0].word).toBe('museum');
    });

    it('keeps free topic detail accessible without a subscription', async () => {
      const freeTopic = topic(false);
      const { service, prisma } = createPremiumService(false, freeTopic);

      const result = await service.getTopicDetails(freeTopic.id);

      expect(result.isPro).toBe(false);
      expect(prisma.vocabWord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { topicId: freeTopic.id } }),
      );
    });
  });

  describe('setMastered', () => {
    it('sets 10 minutes nextReviewAt when isMastered is false', async () => {
      const prisma = (service as any).prisma;
      prisma.userVocabWordProgress = {
        findUnique: jest.fn().mockResolvedValue({ id: 1, isMastered: false }),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(data)),
      };

      const before = Date.now();
      const res = await service.setMastered(1, 10, false);

      expect(res.isMastered).toBe(false);
      const diffMinutes = (res.nextReviewAt!.getTime() - before) / (60 * 1000);
      expect(Math.round(diffMinutes)).toBe(10);
    });

    it('sets 7 days nextReviewAt when isMastered is true', async () => {
      const prisma = (service as any).prisma;
      prisma.userVocabWordProgress = {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(data)),
      };

      const before = Date.now();
      const res = await service.setMastered(1, 10, true);

      expect(res.isMastered).toBe(true);
      const diffDays =
        (res.nextReviewAt!.getTime() - before) / (24 * 60 * 60 * 1000);
      expect(Math.round(diffDays)).toBe(7);
    });

    it('waits for the gamification event when a word becomes mastered', async () => {
      const prisma = (service as any).prisma;
      const eventEmitter = (service as any).eventEmitter;
      prisma.learningActivity = { create: jest.fn().mockResolvedValue({}) };
      prisma.userVocabWordProgress = {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...data, isMastered: true }),
          ),
      };

      await service.setMastered(1, 10, true);

      expect(eventEmitter.emitAsync).toHaveBeenCalledWith('vocab.learned', {
        userId: 1,
        count: 1,
        wordId: 10,
        wordIds: [10],
        source: 'vocabulary_review',
      });
    });
  });

  describe('submitReview', () => {
    it('schedules review for incorrect answer at 10 minutes', async () => {
      const prisma = (service as any).prisma;
      prisma.userVocabWordProgress = {
        findUnique: jest.fn().mockResolvedValue({ id: 1, reviewCount: 2 }),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(data)),
      };

      const before = Date.now();
      const res = await service.submitReview(1, 10, false);
      const diffMinutes = (res.nextReviewAt!.getTime() - before) / (60 * 1000);
      expect(Math.round(diffMinutes)).toBe(10);
      expect(res.isMastered).toBe(false);
      expect(res.remindedAt).toBeNull();
    });

    it('schedules review for correct answer with count=1 at 1 day', async () => {
      const prisma = (service as any).prisma;
      prisma.userVocabWordProgress = {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(data)),
      };

      const before = Date.now();
      const res = await service.submitReview(1, 10, true);
      const diffDays =
        (res.nextReviewAt!.getTime() - before) / (24 * 60 * 60 * 1000);
      expect(Math.round(diffDays)).toBe(1);
    });
  });
});
