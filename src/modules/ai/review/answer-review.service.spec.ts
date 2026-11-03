/* eslint-disable @typescript-eslint/require-await */
import { AnswerReviewService } from './answer-review.service';
import { AnswerReviewer, ReviewerOutputError } from './answer-reviewer';
import { OpenAiCompatibleReviewer } from './reviewers';
import { solvePrompt } from '../toeic-answer-review-prompt';
import { validateSolveOutput } from '../../toeic/toeic-answer-review.logic';
import { CLOUDFLARE_UNAVAILABLE } from '../cloudflare-workers-ai.client';

const expected = [{ id: 'q1', optionCount: 4, part: 5 }];
const goodReply = (choice = 0) => ({
  answers: [
    {
      id: 'q1',
      choice,
      alsoCorrect: [],
      answerable: true,
      evidence: [],
      reasoning: 'grammar',
      evidenceSupportsAnswer: true,
    },
  ],
});

function fake(
  name: AnswerReviewer['name'],
  behaviour: () => Promise<unknown>,
  model = name === 'gemini' ? 'gemini-test' : '@cf/openai/gpt-oss-120b',
  vendor: string | null = name === 'gemini' ? 'google' : 'openai',
): AnswerReviewer & { reviewJson: jest.Mock } {
  return {
    name,
    supportsImages: name === 'gemini',
    configured: () => true,
    model: () => model,
    vendor: () => vendor,
    reviewJson: jest.fn(async () => ({ data: await behaviour(), model })),
  };
}

const outage = () =>
  Promise.reject(
    Object.assign(new Error('down'), { code: CLOUDFLARE_UNAVAILABLE }),
  );

function service(reviewers: AnswerReviewer[]) {
  const subject = new AnswerReviewService(
    { textModel: () => '@cf/openai/gpt-oss-120b' } as any,
    {} as any,
    {} as any,
  );
  subject.useReviewers(reviewers);
  return subject;
}

const run = (subject: AnswerReviewService, generatorVendor = 'google') =>
  subject.run({
    stepName: 'independentSolve',
    chain: subject.solveChain(),
    prompt: solvePrompt({ part: 5, groups: [] }),
    generatorVendor,
    validate: (data) => validateSolveOutput(expected, data),
  });

describe('AnswerReviewService provider chain', () => {
  const env = process.env.TOEIC_SOLVE_REVIEWERS;
  afterEach(() => {
    if (env === undefined) delete process.env.TOEIC_SOLVE_REVIEWERS;
    else process.env.TOEIC_SOLVE_REVIEWERS = env;
  });

  it('Cloudflare answering is an independent review', async () => {
    const cloudflare = fake('cloudflare', async () => goodReply());
    const gemini = fake('gemini', async () => goodReply());
    const result = await run(service([cloudflare, gemini]));
    expect(result.step).toMatchObject({
      status: 'OK',
      provider: 'cloudflare',
      model: '@cf/openai/gpt-oss-120b',
      modelVendor: 'openai',
      reviewKind: 'INDEPENDENT',
    });
    expect(gemini.reviewJson).not.toHaveBeenCalled();
  });

  it('a Cloudflare outage falls back to Gemini, recorded as same-provider', async () => {
    const cloudflare = fake('cloudflare', outage);
    const gemini = fake('gemini', async () => goodReply());
    const result = await run(service([cloudflare, gemini]));
    expect(result.step).toMatchObject({
      status: 'OK',
      provider: 'gemini',
      reviewKind: 'SAME_PROVIDER',
    });
    expect(result.step.tried).toEqual([
      expect.objectContaining({
        provider: 'cloudflare',
        reason: expect.stringContaining('unavailable'),
      }),
    ]);
  });

  it('a timeout moves on to the next provider', async () => {
    const cloudflare = fake('cloudflare', () =>
      Promise.reject(
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
      ),
    );
    const gemini = fake('gemini', async () => goodReply());
    expect((await run(service([cloudflare, gemini]))).step.provider).toBe(
      'gemini',
    );
  });

  it('invalid JSON moves on to the next provider', async () => {
    const cloudflare = fake('cloudflare', () =>
      Promise.reject(new ReviewerOutputError('not JSON')),
    );
    const gemini = fake('gemini', async () => goodReply());
    const result = await run(service([cloudflare, gemini]));
    expect(result.step.provider).toBe('gemini');
    expect(result.step.tried[0].reason).toContain('invalid');
  });

  it('a schema-invalid reply moves on to the next provider', async () => {
    const cloudflare = fake('cloudflare', async () => ({ answers: [] }));
    const gemini = fake('gemini', async () => goodReply());
    expect((await run(service([cloudflare, gemini]))).step.provider).toBe(
      'gemini',
    );
  });

  it('every reply invalid makes the step INVALID', async () => {
    const result = await run(
      service([
        fake('cloudflare', async () => ({ answers: 'x' })),
        fake('gemini', () => Promise.reject(new ReviewerOutputError('bad'))),
      ]),
    );
    expect(result.step.status).toBe('INVALID');
    expect(result.answers).toBeUndefined();
  });

  it('no provider reachable makes the step UNAVAILABLE', async () => {
    const result = await run(
      service([fake('cloudflare', outage), fake('gemini', outage)]),
    );
    expect(result.step).toMatchObject({
      status: 'UNAVAILABLE',
      provider: null,
    });
  });

  it('a valid disagreement ends the chain: no further provider is called', async () => {
    const cloudflare = fake('cloudflare', async () => goodReply(3));
    const gemini = fake('gemini', async () => goodReply(0));
    const result = await run(service([cloudflare, gemini]));
    expect(result.answers!.get('q1')!.choice).toBe(3);
    expect(gemini.reviewJson).toHaveBeenCalledTimes(0);
  });

  it('Cloudflare reviewing a batch the Cloudflare stand-in wrote is not independent', async () => {
    const result = await run(
      service([fake('cloudflare', async () => goodReply())]),
      'openai',
    );
    expect(result.step.reviewKind).toBe('SAME_PROVIDER');
  });

  it('a Cloudflare model made by Google is not independent of Gemini', async () => {
    const result = await run(
      service([
        fake(
          'cloudflare',
          async () => goodReply(),
          '@cf/google/gemma-3-12b-it',
          'google',
        ),
      ]),
    );
    expect(result.step).toMatchObject({
      modelVendor: 'google',
      reviewKind: 'SAME_PROVIDER',
    });
  });

  it('an OpenAI-compatible model without a declared vendor is not independent', async () => {
    process.env.TOEIC_SOLVE_REVIEWERS = 'openai-compatible';
    const result = await run(
      service([
        fake('openai-compatible', async () => goodReply(), 'qwen2.5:7b', null),
      ]),
    );
    expect(result.step).toMatchObject({
      provider: 'openai-compatible',
      reviewKind: 'SAME_PROVIDER',
    });
  });

  it('reads the chain order from TOEIC_SOLVE_REVIEWERS', () => {
    process.env.TOEIC_SOLVE_REVIEWERS = 'gemini, openai-compatible';
    expect(
      service([])
        .solveChain()
        .map((reviewer) => reviewer.name),
    ).toEqual(['gemini', 'openai-compatible']);
  });
});

describe('OpenAiCompatibleReviewer', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('calls /v1/chat/completions and declares its vendor only when told', async () => {
    process.env.AI_COMPAT_BASE_URL = 'http://localhost:11434/';
    process.env.AI_COMPAT_MODEL = 'qwen2.5:7b';
    delete process.env.AI_COMPAT_API_KEY;
    delete process.env.AI_COMPAT_MODEL_VENDOR;
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'qwen2.5:7b',
        choices: [{ message: { content: JSON.stringify(goodReply()) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    });
    const reviewer = new OpenAiCompatibleReviewer(fetchImpl as any);
    expect(reviewer.configured()).toBe(true);
    expect(reviewer.vendor()).toBeNull();
    const reply = await reviewer.reviewJson(
      solvePrompt({ part: 5, groups: [] }),
    );
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.model).toBe('qwen2.5:7b');
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBeUndefined();
    expect(reply).toMatchObject({
      data: goodReply(),
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    process.env.AI_COMPAT_MODEL_VENDOR = 'Alibaba';
    expect(reviewer.vendor()).toBe('alibaba');
  });

  it('a reply that is not JSON is invalid, an HTTP 503 is an outage', async () => {
    process.env.AI_COMPAT_BASE_URL = 'http://localhost:11434';
    process.env.AI_COMPAT_MODEL = 'm';
    const notJson = new OpenAiCompatibleReviewer(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
      }) as any,
    );
    await expect(
      notJson.reviewJson(solvePrompt({ part: 5, groups: [] })),
    ).rejects.toBeInstanceOf(ReviewerOutputError);
    const down = new OpenAiCompatibleReviewer(
      jest.fn().mockResolvedValue({ ok: false, status: 503 }) as any,
    );
    await expect(
      down.reviewJson(solvePrompt({ part: 5, groups: [] })),
    ).rejects.toMatchObject({
      status: 503,
    });
  });
});
