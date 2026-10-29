/**
 * Scripted pronunciation assessment (READ_ALOUD / PRONUNCIATION_DRILL): the
 * required Azure scores must be real measurements. A score of 0 is valid; a
 * missing, null or non-finite score is a provider failure (retried by the
 * speaking queue), never a learner grade of 0. Prosody is optional.
 */
import { GeminiEvaluatorStrategy } from './gemini-evaluator.strategy';

const TARGET = 'The library opens at eight';
const words = (accuracy = 90) =>
  TARGET.split(' ').map((Word, i) => ({
    Word: Word.toLowerCase(),
    Offset: i * 1_000_000,
    Duration: 800_000,
    PronunciationAssessment: { AccuracyScore: accuracy, ErrorType: 'None' },
  }));

function azure(scores: Record<string, unknown> | undefined, extra = {}) {
  return {
    RecognitionStatus: 'Success',
    NBest: [
      {
        Display: `${TARGET}.`,
        ...(scores === undefined ? {} : { PronunciationAssessment: scores }),
        Words: words(),
        ...extra,
      },
    ],
  };
}

const full = {
  AccuracyScore: 94,
  FluencyScore: 100,
  CompletenessScore: 100,
  PronScore: 96.4,
};

describe('scripted pronunciation assessment: required Azure scores', () => {
  const originalFetch = global.fetch;
  const env = { ...process.env };
  let strategy: GeminiEvaluatorStrategy;

  beforeEach(() => {
    process.env.AZURE_SPEECH_KEY = 'test-key';
    process.env.AZURE_SPEECH_REGION = 'test-region';
    delete process.env.SPEAKING_INLINE_GEMINI_FEEDBACK;
    strategy = new GeminiEvaluatorStrategy();
    jest
      .spyOn((strategy as any).logger, 'error')
      .mockImplementation(() => undefined);
    jest
      .spyOn((strategy as any).logger, 'log')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  const respond = (body: unknown) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }) as never;
  };
  const assess = () =>
    strategy.assessPronunciation(TARGET, Buffer.from('RIFF....WAVE'));

  it('maps a complete response: score = PronScore / 10, raw metrics kept', async () => {
    respond(azure(full));
    const r = await assess();
    expect(r.overallScore).toBe(9.6);
    expect(r).toMatchObject({
      accuracyScore: 94,
      fluencyScore: 100,
      completenessScore: 100,
      isSilentOrNoSpeech: false,
    });
  });

  it('keeps a genuinely measured zero', async () => {
    respond(azure({ ...full, FluencyScore: 0 }));
    const r = await assess();
    expect(r.fluencyScore).toBe(0);
    expect(r.overallScore).toBe(9.6);
  });

  it('accepts a response without the optional prosody score', async () => {
    respond(azure(full));
    const r = await assess();
    expect('prosodyScore' in r).toBe(false);
  });

  it.each([
    ['missing PronScore', { ...full, PronScore: undefined }],
    ['null AccuracyScore', { ...full, AccuracyScore: null }],
    ['missing CompletenessScore', { ...full, CompletenessScore: undefined }],
    ['non-finite FluencyScore', { ...full, FluencyScore: Number.NaN }],
    ['string PronScore', { ...full, PronScore: '96' }],
    ['out-of-range AccuracyScore', { ...full, AccuracyScore: 140 }],
  ])(
    '%s is a retryable provider failure, not a grade of 0',
    async (_label, scores) => {
      respond(azure(scores));
      await expect(assess()).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
        message: expect.stringContaining('AZURE_RESPONSE_MISSING_SCORES'),
      });
    },
  );

  it('a partial response without any pronunciation scores is a provider failure', async () => {
    respond(azure(undefined));
    await expect(assess()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('silence is still NO_SPEECH (no score, no failure)', async () => {
    respond({ RecognitionStatus: 'InitialSilenceTimeout', NBest: [] });
    const r = await assess();
    expect(r).toMatchObject({
      isSilentOrNoSpeech: true,
      errorCode: 'NO_SPEECH',
    });
  });

  it('a transport error stays a retryable provider failure', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNRESET')) as never;
    await expect(assess()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
});
