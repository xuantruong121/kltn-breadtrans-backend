import { ContentFilesService } from './content-files.service';
import { CONTENT_R2_RETRY_SET } from './content-files.logic';

/** Bug 2026-11-22: the R2 files of a deleted content item, after the commit. */
describe('ContentFilesService', () => {
  const base = 'https://pub-123.r2.dev';
  const quiz = { kind: 'listening-quiz', quizId: 103 } as const;
  const own1 =
    'catalog/listening/practice/audio/quiz-103/question-415/v1/a.mp3';
  const own2 = 'catalog/listening/practice/quiz-103/audio/v1/full.mp3';

  const build = (
    over: {
      assets?: string[];
      exercises?: string[];
      quizCount?: number;
      failKeys?: string[];
      queued?: string[];
    } = {},
  ) => {
    const prisma: any = {
      quizAudioAsset: {
        findMany: jest
          .fn()
          .mockResolvedValue((over.assets ?? []).map((key) => ({ key }))),
      },
      listeningAudioArtifact: { findMany: jest.fn().mockResolvedValue([]) },
      listeningDiagnosticClip: { findMany: jest.fn().mockResolvedValue([]) },
      speakingExercise: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            (over.exercises ?? []).map((audioUrl) => ({ audioUrl })),
          ),
        count: jest.fn().mockResolvedValue(0),
      },
      quiz: { count: jest.fn().mockResolvedValue(over.quizCount ?? 0) },
      question: { count: jest.fn().mockResolvedValue(0) },
    };
    const r2: any = {
      getPublicUrl: jest.fn().mockReturnValue(base),
      deleteFile: jest.fn((key: string) =>
        (over.failKeys ?? []).includes(key)
          ? Promise.reject(new Error('R2 down'))
          : Promise.resolve(),
      ),
    };
    const redis: any = {
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue(over.queued ?? []),
    };
    return {
      service: new ContentFilesService(prisma, r2, redis),
      prisma,
      r2,
      redis,
    };
  };

  describe('removeFiles', () => {
    it("deletes the keys under the item's own prefix, once each", async () => {
      const { service, r2 } = build();

      const result = await service.removeFiles([
        { owner: quiz, stored: own1 },
        { owner: quiz, stored: own1 },
        { owner: quiz, stored: own2 },
      ]);

      expect(r2.deleteFile.mock.calls).toEqual([[own1], [own2]]);
      expect(result).toEqual({ deleted: 2, inUse: 0, queued: 0 });
    });

    it('never deletes a typed URL, a shared picture or a key outside the prefix', async () => {
      const { service, r2, prisma } = build();

      await service.removeFiles([
        { owner: quiz, stored: 'https://evil.example/audio/a.mp3' },
        { owner: quiz, stored: 'images/4f0e.png' },
        {
          owner: quiz,
          stored: 'catalog/listening/practice/images/office.webp',
        },
        { owner: quiz, stored: 'premium/speaking/practice/19/rec.wav' },
        {
          owner: quiz,
          stored: 'catalog/listening/practice/audio/quiz-7/question-1/v1/a.mp3',
        },
        { owner: quiz, stored: '/listening/quiz-103/question-1/v1/a.mp3' },
        { owner: quiz, stored: null },
      ]);

      expect(r2.deleteFile).not.toHaveBeenCalled();
      // Nothing valid: not even a database read.
      expect(prisma.quizAudioAsset.findMany).not.toHaveBeenCalled();
    });

    it('keeps a key that a row still points at, such as an exam copy', async () => {
      const ref = 'catalog/speaking/reference/5.r1.mp3';
      const { service, r2 } = build({ exercises: [`${base}/${ref}`] });

      const result = await service.removeFiles([
        {
          owner: { kind: 'speaking-exercise', exerciseId: 5 },
          stored: `${base}/${ref}`,
        },
      ]);

      expect(r2.deleteFile).not.toHaveBeenCalled();
      expect(result.inUse).toBe(1);
    });

    it('reads a free Speaking reference audio from its public URL', async () => {
      const { service, r2 } = build();

      await service.removeFiles([
        {
          owner: { kind: 'speaking-exercise', exerciseId: 5 },
          stored: `${base}/catalog/speaking/reference/5.r1.mp3`,
        },
        {
          owner: { kind: 'speaking-exercise', exerciseId: 6 },
          stored: 'premium/speaking/reference/6.r2.mp3',
        },
      ]);

      expect(r2.deleteFile.mock.calls).toEqual([
        ['catalog/speaking/reference/5.r1.mp3'],
        ['premium/speaking/reference/6.r2.mp3'],
      ]);
    });

    it('queues a failed delete for the retry, and never throws', async () => {
      const { service, redis } = build({ failKeys: [own2] });

      const result = await service.removeFiles([
        { owner: quiz, stored: own1 },
        { owner: quiz, stored: own2 },
      ]);

      expect(result).toEqual({ deleted: 1, inUse: 0, queued: 1 });
      expect(redis.sadd).toHaveBeenCalledWith(CONTENT_R2_RETRY_SET, own2);
    });

    it('queues every key when the database cannot answer, and never throws', async () => {
      const { service, prisma, r2, redis } = build();
      prisma.quizAudioAsset.findMany.mockRejectedValue(new Error('db down'));
      redis.sadd.mockRejectedValue(new Error('redis down'));

      await expect(
        service.removeFiles([
          { owner: quiz, stored: own1 },
          { owner: quiz, stored: own2 },
        ]),
      ).resolves.toEqual({ deleted: 0, inUse: 0, queued: 2 });
      expect(r2.deleteFile).not.toHaveBeenCalled();
      expect(redis.sadd).toHaveBeenCalledWith(CONTENT_R2_RETRY_SET, own1, own2);
    });
  });

  describe('retryFailed', () => {
    it('deletes a queued key of a deleted quiz and takes it off the queue', async () => {
      const { service, r2, redis } = build({ queued: [own2] });

      await expect(service.retryFailed()).resolves.toEqual({
        deleted: 1,
        dropped: 0,
        failed: 0,
      });
      expect(r2.deleteFile).toHaveBeenCalledWith(own2);
      expect(redis.srem).toHaveBeenCalledWith(CONTENT_R2_RETRY_SET, own2);
    });

    it('drops a key that is not a content file, without deleting it', async () => {
      const queued = [
        'images/4f0e.png',
        'premium/speaking/practice/19/rec.wav',
        'https://evil.example/a.mp3',
        '../etc/passwd',
      ];
      const { service, r2, redis } = build({ queued });

      await expect(service.retryFailed()).resolves.toMatchObject({
        deleted: 0,
        dropped: 4,
      });
      expect(r2.deleteFile).not.toHaveBeenCalled();
      expect(redis.srem).toHaveBeenCalledTimes(4);
    });

    it('drops a key whose content still exists, or that a row still uses', async () => {
      for (const over of [{ quizCount: 1 }, { assets: [own2] }]) {
        const { service, r2, redis } = build({ queued: [own2], ...over });

        await expect(service.retryFailed()).resolves.toMatchObject({
          deleted: 0,
          dropped: 1,
        });
        expect(r2.deleteFile).not.toHaveBeenCalled();
        expect(redis.srem).toHaveBeenCalledWith(CONTENT_R2_RETRY_SET, own2);
      }
    });

    it('keeps a key that still fails for the next run', async () => {
      const { service, redis } = build({ queued: [own2], failKeys: [own2] });

      await expect(service.retryFailed()).resolves.toMatchObject({
        failed: 1,
      });
      expect(redis.srem).not.toHaveBeenCalled();
    });
  });
});
