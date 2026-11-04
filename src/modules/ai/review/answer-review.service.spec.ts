/* eslint-disable @typescript-eslint/require-await */
import { AnswerReviewService } from './answer-review.service';
import {
  AnswerReviewer,
  ReviewerOutputError,
  isProviderOutage,
} from './answer-reviewer';
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

  it('a spent daily allocation is recorded, and the next step skips Cloudflare without calling it', async () => {
    const store = new Map<string, string>();
    const redis = {
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      pipeline: () => ({
        hincrby: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn(async () => []),
      }),
    };
    const spent = Object.assign(
      new Error(
        'Cloudflare Workers AI: you have used up your daily free allocation of 10,000 neurons',
      ),
      { code: CLOUDFLARE_UNAVAILABLE },
    );
    const cloudflare = fake('cloudflare', () => Promise.reject(spent));
    const gemini = fake('gemini', async () => goodReply());
    const subject = new AnswerReviewService(
      { textModel: () => '@cf/openai/gpt-oss-120b' } as any,
      {} as any,
      {} as any,
      redis as any,
    );
    subject.useReviewers([cloudflare, gemini]);

    expect((await run(subject)).step.provider).toBe('gemini');
    expect(store.get('ai:provider-exhausted:cloudflare')).toBeDefined();

    const second = await run(subject);
    expect(second.step.provider).toBe('gemini');
    expect(cloudflare.reviewJson).toHaveBeenCalledTimes(1);
    expect(second.step.tried).toEqual([
      expect.objectContaining({
        provider: 'cloudflare',
        reason: expect.stringContaining('quota spent until'),
      }),
    ]);
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

  const okFetch = () =>
    jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(goodReply()) } }],
      }),
    });

  it('asks for strict structured output, and sends reasoning options only when set', async () => {
    process.env.AI_COMPAT_BASE_URL = 'https://api.groq.com/openai';
    process.env.AI_COMPAT_MODEL = 'openai/gpt-oss-120b';
    delete process.env.AI_COMPAT_STRICT_SCHEMA;
    delete process.env.AI_COMPAT_REASONING_EFFORT;
    delete process.env.AI_COMPAT_INCLUDE_REASONING;
    const plain = okFetch();
    await new OpenAiCompatibleReviewer(plain as any).reviewJson(
      solvePrompt({ part: 5, groups: [] }),
    );
    const body = JSON.parse(plain.mock.calls[0][1].body);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(
      body.response_format.json_schema.schema.properties.answers.items
        .additionalProperties,
    ).toBe(false);
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('include_reasoning');

    process.env.AI_COMPAT_REASONING_EFFORT = 'low';
    process.env.AI_COMPAT_INCLUDE_REASONING = 'false';
    const tuned = okFetch();
    await new OpenAiCompatibleReviewer(tuned as any).reviewJson(
      solvePrompt({ part: 5, groups: [] }),
    );
    expect(JSON.parse(tuned.mock.calls[0][1].body)).toMatchObject({
      reasoning_effort: 'low',
      include_reasoning: false,
    });

    process.env.AI_COMPAT_STRICT_SCHEMA = 'false';
    const loose = okFetch();
    await new OpenAiCompatibleReviewer(loose as any).reviewJson(
      solvePrompt({ part: 5, groups: [] }),
    );
    const looseSchema = JSON.parse(loose.mock.calls[0][1].body).response_format
      .json_schema;
    expect(looseSchema.strict).toBeUndefined();
    expect(JSON.stringify(looseSchema.schema)).not.toContain(
      'additionalProperties',
    );
  });

  it('429 and 413 are outages with the retry-after hint, 400 is an invalid reply', async () => {
    process.env.AI_COMPAT_BASE_URL = 'https://api.groq.com/openai';
    process.env.AI_COMPAT_MODEL = 'openai/gpt-oss-120b';
    const failing = (status: number, retryAfter?: string) =>
      new OpenAiCompatibleReviewer(
        jest.fn().mockResolvedValue({
          ok: false,
          status,
          headers: {
            get: (name: string) =>
              name === 'retry-after' ? (retryAfter ?? null) : null,
          },
        }) as any,
      ).reviewJson(solvePrompt({ part: 5, groups: [] }));

    const limited = await failing(429, '3600').catch((error) => error);
    expect(limited).toMatchObject({ status: 429, retryAfterSeconds: 3600 });
    expect(isProviderOutage(limited)).toBe(true);
    const tooLarge = await failing(413).catch((error) => error);
    expect(tooLarge.retryAfterSeconds).toBeUndefined();
    expect(isProviderOutage(tooLarge)).toBe(true);
    expect(isProviderOutage(await failing(400).catch((error) => error))).toBe(
      false,
    );
  });
});
