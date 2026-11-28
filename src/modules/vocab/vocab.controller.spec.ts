import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { VocabController } from './vocab.controller';
import { VocabService } from './vocab.service';

describe('VocabController', () => {
  let controller: VocabController;
  const vocabService = { submitReview: jest.fn() };

  beforeEach(async () => {
    vocabService.submitReview.mockReset();
    vocabService.submitReview.mockResolvedValue({ grade: 'GOOD' });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VocabController],
      providers: [{ provide: VocabService, useValue: vocabService }],
    }).compile();

    controller = module.get<VocabController>(VocabController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('submitReview evidence (2026-11-26)', () => {
    const req = { user: { id: 7 } };
    const evidence = {
      quiz: 'CORRECT',
      typing: 'WRONG',
      typingHints: 0,
      speaking: 'SKIPPED',
      quickCheck: false,
    };

    it('passes the parsed steps to the service', async () => {
      await controller.submitReview(10, true, undefined, evidence, req);
      expect(vocabService.submitReview).toHaveBeenCalledWith(
        7,
        10,
        true,
        undefined,
        evidence,
      );
    });

    it('refuses steps it cannot read, before the service is called', () => {
      expect(() =>
        controller.submitReview(
          10,
          true,
          undefined,
          { ...evidence, quiz: 'RIGHT' },
          req,
        ),
      ).toThrow(BadRequestException);
      expect(vocabService.submitReview).not.toHaveBeenCalled();
    });

    it('still takes an old body with only a grade', async () => {
      await controller.submitReview(10, true, 'HARD', undefined, req);
      expect(vocabService.submitReview).toHaveBeenCalledWith(
        7,
        10,
        true,
        'HARD',
        undefined,
      );
    });
  });
});
