import { Test, TestingModule } from '@nestjs/testing';
import { VocabService } from './vocab.service';
import { PrismaService } from '../../prisma/prisma.service';

import { EventEmitter2 } from '@nestjs/event-emitter';

describe('VocabService', () => {
  let service: VocabService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VocabService,
        { provide: PrismaService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get<VocabService>(VocabService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setMastered', () => {
    it('sets 10 minutes nextReviewAt when isMastered is false', async () => {
      const prisma = (service as any).prisma;
      prisma.userVocabWordProgress = {
        findUnique: jest.fn().mockResolvedValue({ id: 1, isMastered: false }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      };

      const before = Date.now();
      const res = await service.setMastered(1, 10, false);
      const after = Date.now();

      expect(res.isMastered).toBe(false);
      const diffMinutes = (res.nextReviewAt!.getTime() - before) / (60 * 1000);
      expect(Math.round(diffMinutes)).toBe(10);
    });

    it('sets 7 days nextReviewAt when isMastered is true', async () => {
      const prisma = (service as any).prisma;
      prisma.userVocabWordProgress = {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      };

      const before = Date.now();
      const res = await service.setMastered(1, 10, true);

      expect(res.isMastered).toBe(true);
      const diffDays = (res.nextReviewAt!.getTime() - before) / (24 * 60 * 60 * 1000);
      expect(Math.round(diffDays)).toBe(7);
    });
  });

  describe('submitReview', () => {
    it('schedules review for incorrect answer at 10 minutes', async () => {
      const prisma = (service as any).prisma;
      prisma.userVocabWordProgress = {
        findUnique: jest.fn().mockResolvedValue({ id: 1, reviewCount: 2 }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
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
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      };

      const before = Date.now();
      const res = await service.submitReview(1, 10, true);
      const diffDays = (res.nextReviewAt!.getTime() - before) / (24 * 60 * 60 * 1000);
      expect(Math.round(diffDays)).toBe(1);
    });
  });
});

