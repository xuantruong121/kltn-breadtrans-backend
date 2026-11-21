import { AccountPurgeService } from './account-purge.service';
import { R2_RETRY_SET } from './account-deletion.logic';

/**
 * Security review 2026-11-21: the purge deleted whatever a learner had typed
 * into their avatar or a suggestion link, so a throwaway account could have
 * exam media or another learner's file deleted. Only the learner's own
 * recordings may go now, and a queued retry of any other key is dropped.
 */
describe('AccountPurgeService files', () => {
  const r2 = { deleteFile: jest.fn().mockResolvedValue(undefined) };
  const redis = {
    smembers: jest.fn(),
    srem: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
  };
  const profile = { findUnique: jest.fn() };
  const suggestionAttachment = { findMany: jest.fn() };
  const prisma = {
    speakingSubmission: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { audioKey: 'premium/speaking/practice/19/own.wav' },
          { audioKey: 'premium/listening/quiz-12/audio/v1/full.mp3' },
          { audioKey: null },
        ]),
    },
    speakingUploadIntent: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { objectKey: 'premium/speaking/practice/pending/19/i.wav' },
          { objectKey: 'premium/speaking/practice/20/other.wav' },
        ]),
    },
    diagnosticSpeakingResponse: {
      findMany: jest.fn().mockResolvedValue([
        {
          audioKey: 'premium/speaking/diagnostic/5/61/12/a.webm',
          assessmentId: 5,
          attemptId: 61,
        },
        {
          audioKey: 'premium/speaking/diagnostic/5/99/12/b.webm',
          assessmentId: 5,
          attemptId: 61,
        },
      ]),
    },
    profile,
    suggestionAttachment,
  };
  const service = new AccountPurgeService(
    prisma as never,
    r2 as never,
    redis as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it("lists only the learner's own recordings, never the avatar or attachments", async () => {
    await expect(service.filesOf(19)).resolves.toEqual([
      'premium/speaking/practice/19/own.wav',
      'premium/speaking/practice/pending/19/i.wav',
      'premium/speaking/diagnostic/5/61/12/a.webm',
    ]);
    expect(profile.findUnique).not.toHaveBeenCalled();
    expect(suggestionAttachment.findMany).not.toHaveBeenCalled();
  });

  it('drops a queued retry that is not a recording instead of deleting it', async () => {
    redis.smembers.mockResolvedValue([
      'premium/speaking/practice/19/own.wav',
      'ai/toeic-exams/exam-5/writing/1.jpg',
      'premium/listening/quiz-12/audio/v1/full.mp3',
    ]);
    const retried = await (
      service as unknown as { retryFiles(): Promise<number> }
    ).retryFiles();
    expect(retried).toBe(1);
    expect(r2.deleteFile).toHaveBeenCalledTimes(1);
    expect(r2.deleteFile).toHaveBeenCalledWith(
      'premium/speaking/practice/19/own.wav',
    );
    expect(redis.srem).toHaveBeenCalledWith(
      R2_RETRY_SET,
      'ai/toeic-exams/exam-5/writing/1.jpg',
    );
    expect(redis.srem).toHaveBeenCalledWith(
      R2_RETRY_SET,
      'premium/listening/quiz-12/audio/v1/full.mp3',
    );
  });
});
