import { ConflictException } from '@nestjs/common';
import { ListeningAudioAuthoringService } from './listening-audio-authoring.service';

/** Capacity run 2026-11-09: the published track's state is kept for 60 s. */
describe('published listening track state cache', () => {
  const artifact = {
    id: 7,
    version: 2,
    checksumSha256: 'abc',
    synthesisHash: 'h1',
    r2Key: 'catalog/listening/practice/quiz-58/audio/v2/full.mp3',
    r2Url: null,
  };
  const make = () => {
    const upload = {
      getPublicAssetUrl: jest.fn(
        (key: string) => `https://public.example/${key}`,
      ),
    };
    const svc = new ListeningAudioAuthoringService(
      {} as never,
      upload as never,
    );
    const s = svc as unknown as Record<string, jest.Mock>;
    const getArtifact = jest
      .spyOn(svc, 'getArtifact')
      .mockResolvedValue(artifact as never);
    const validateContent = jest
      .spyOn(s as never, 'validateContent' as never)
      .mockResolvedValue({ synthesisHash: 'h1' } as never);
    jest
      .spyOn(s as never, 'isPremiumListeningQuiz' as never)
      .mockResolvedValue(false as never);
    return { svc, getArtifact, validateContent };
  };

  afterEach(() => jest.useRealTimers());

  it('checks a track once per minute, not once per question played', async () => {
    const { svc, getArtifact, validateContent } = make();
    for (let i = 0; i < 5; i += 1) {
      await expect(svc.getPublishedAudioUrl(58)).resolves.toMatchObject({
        url: `https://public.example/${artifact.r2Key}`,
      });
    }
    expect(getArtifact).toHaveBeenCalledTimes(1);
    expect(validateContent).toHaveBeenCalledTimes(1);
  });

  it('still refuses a request for another version on every call', async () => {
    const { svc } = make();
    await svc.getPublishedAudioUrl(58);
    await expect(
      svc.getPublishedAudioUrl(58, { artifactId: 6 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('looks again after 60 s, and sees a script edited since', async () => {
    jest.useFakeTimers({ now: 5_000_000 });
    const { svc, validateContent } = make();
    await svc.getPublishedAudioUrl(58);
    validateContent.mockResolvedValue({ synthesisHash: 'edited' } as never);
    jest.setSystemTime(
      5_000_000 + ListeningAudioAuthoringService.PLAYABLE_TTL_MS + 1,
    );
    await expect(svc.getPublishedAudioUrl(58)).rejects.toMatchObject({
      response: { code: 'LISTENING_FULL_AUDIO_STALE' },
    });
  });
});
