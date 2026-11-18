import { HttpException } from '@nestjs/common';

import { SPEAKING_REPLAYED, SpeakingService } from './speaking.service';

/**
 * One AI grading per Speaking submission (audit follow-up 2026-11-18): the
 * guard took one before the handler, so a retried finalize or a resent
 * Idempotency-Key took a second grading for the submission it got back.
 */
describe('Speaking AI grading per submission', () => {
  const build = (intent: unknown = { userId: 7, status: 'PENDING' }) => {
    const service: any = Object.create(SpeakingService.prototype);
    service.redis = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      decr: jest.fn().mockResolvedValue(0),
    };
    service.subscriptions = {
      planCodeFor: jest.fn().mockResolvedValue('FREE'),
    };
    service.prisma = {
      speakingUploadIntent: { findUnique: jest.fn().mockResolvedValue(intent) },
      speakingSubmission: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service.finalizeUpload = jest.fn().mockResolvedValue({ submissionId: 4 });
    service.submitAudio = jest.fn().mockResolvedValue({ submissionId: 5 });
    return service;
  };

  it('a finalize retried after it went through takes no second grading, even with none left', async () => {
    const service = build({ userId: 7, status: 'FINALIZED', submissionId: 3 });
    service.redis.incr.mockResolvedValue(1000);
    service.finalizeUpload.mockResolvedValue({ submissionId: 3 });

    await expect(
      service.finalizeUploadForLearner('intent-1', 7),
    ).resolves.toEqual({ submissionId: 3 });
    expect(service.redis.incr).not.toHaveBeenCalled();
  });

  it('a new finalize takes exactly one grading and keeps it', async () => {
    const service = build();

    await service.finalizeUploadForLearner('intent-1', 7);

    expect(service.redis.incr).toHaveBeenCalledTimes(1);
    expect(service.redis.decr).not.toHaveBeenCalled();
  });

  it('with no grading left: 429 AI_QUOTA_EXHAUSTED, nothing finalized, the count given back', async () => {
    const service = build();
    service.redis.incr.mockResolvedValue(1000);

    const error = await service
      .finalizeUploadForLearner('intent-1', 7)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({
      error: 'AI_QUOTA_EXHAUSTED',
    });
    expect(service.finalizeUpload).not.toHaveBeenCalled();
    expect(service.redis.decr).toHaveBeenCalledTimes(1);
  });

  it('a finalize that fails gives its grading back', async () => {
    const service = build();
    service.finalizeUpload.mockRejectedValue(new Error('R2 down'));

    await expect(
      service.finalizeUploadForLearner('intent-1', 7),
    ).rejects.toThrow('R2 down');
    expect(service.redis.decr).toHaveBeenCalledTimes(1);
  });

  it('a finalize that got the submission another request made gives its grading back', async () => {
    const service = build();
    service.finalizeUpload.mockResolvedValue({
      submissionId: 4,
      [SPEAKING_REPLAYED]: true,
    });

    await service.finalizeUploadForLearner('intent-1', 7);

    expect(service.redis.incr).toHaveBeenCalledTimes(1);
    expect(service.redis.decr).toHaveBeenCalledTimes(1);
  });

  it('a submit with an Idempotency-Key already used takes no grading', async () => {
    const service = build();
    service.prisma.speakingSubmission.findUnique.mockResolvedValue({ id: 5 });

    await service.submitAudioForLearner(1, 7, {}, 'key-1');

    expect(service.redis.incr).not.toHaveBeenCalled();
    expect(service.submitAudio).toHaveBeenCalledTimes(1);
  });

  it('a new submit takes one grading; an admin takes none', async () => {
    const service = build();

    await service.submitAudioForLearner(1, 7, {}, 'key-2');
    await service.submitAudioForLearner(1, 1, {}, 'key-3', undefined, 'ADMIN');

    expect(service.redis.incr).toHaveBeenCalledTimes(1);
  });
});
