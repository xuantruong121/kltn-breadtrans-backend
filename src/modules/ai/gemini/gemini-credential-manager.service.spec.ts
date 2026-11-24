import { Logger } from '@nestjs/common';
import {
  classifyGeminiError,
  GeminiCredentialManager,
  redactGeminiError,
} from './gemini-credential-manager.service';
import { AiTaskType, GeminiModelRouter } from './gemini-model-router';

const redis = () => {
  let counter = 0;
  const cooldown = new Map<string, string>();
  return {
    incr: jest.fn(() => Promise.resolve(++counter)),
    get: jest.fn((key: string) => Promise.resolve(cooldown.get(key) || null)),
    set: jest.fn((key: string, value: string) => {
      cooldown.set(key, value);
      return Promise.resolve('OK');
    }),
    pipeline: jest.fn(() => ({
      incr: jest.fn(),
      incrby: jest.fn(),
      exec: jest.fn(() => Promise.resolve([])),
    })),
  };
};

describe('GeminiCredentialManager', () => {
  const previous = process.env.GEMINI_API_KEYS;
  beforeEach(() => {
    process.env.GEMINI_API_KEYS = 'key-one,key-two,key-one';
  });
  afterAll(() => {
    process.env.GEMINI_API_KEYS = previous;
  });

  it('uses bounded shared selection and skips a rate-limited credential', async () => {
    const cache = redis();
    const manager = new GeminiCredentialManager(
      new GeminiModelRouter(),
      cache as any,
    );
    let calls = 0;
    await expect(
      manager.execute({
        taskType: AiTaskType.TEXT_AUTHORING,
        operation: () => {
          calls += 1;
          if (calls === 1)
            return Promise.reject(
              Object.assign(new Error('quota exceeded'), { status: 429 }),
            );
          return Promise.resolve('ok');
        },
      }),
    ).resolves.toBe('ok');
    expect(calls).toBe(2);
    expect(cache.set).toHaveBeenCalled();
  });

  it('classifies provider failures without relying on a single message shape', () => {
    expect(classifyGeminiError({ status: 503 })).toBe('PROVIDER_TRANSIENT');
    expect(classifyGeminiError({ status: 403 })).toBe('AUTH');
    expect(
      classifyGeminiError(
        Object.assign(new Error('timed out'), { name: 'AbortError' }),
      ),
    ).toBe('TIMEOUT');
  });

  it('rotates to a different, not-cooling-down credential on 503 and respects MAX_ATTEMPTS — never retries the same credential twice', async () => {
    process.env.GEMINI_API_KEYS = 'key-a,key-b,key-c';
    const cache = redis();
    const manager = new GeminiCredentialManager(
      new GeminiModelRouter(),
      cache as any,
    );
    const seenFingerprints: string[] = [];
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await expect(
      manager.execute({
        taskType: AiTaskType.IMAGE_SEMANTIC_VALIDATION,
        operation: () =>
          Promise.reject(
            Object.assign(new Error('high demand'), { status: 503 }),
          ),
      }),
    ).rejects.toThrow();
    // Every failed request logs its model and key; within one model a key is
    // never tried twice. The main model is tried on 3 keys (MAX_ATTEMPTS),
    // then the fallback model once more on 3 keys (owner 2026-11-24).
    const byModel = new Map<string, string[]>();
    for (const call of warnSpy.mock.calls) {
      const match = /model=(\S+) key=([a-f0-9]{12})/.exec(String(call[0]));
      if (!match) continue;
      seenFingerprints.push(match[2]);
      byModel.set(match[1], [...(byModel.get(match[1]) ?? []), match[2]]);
    }
    expect(byModel.size).toBe(2);
    for (const keys of byModel.values()) {
      expect(keys.length).toBe(3); // MAX_ATTEMPTS
      expect(new Set(keys).size).toBe(3); // all distinct
    }
    for (const call of warnSpy.mock.calls)
      for (const key of ['key-a', 'key-b', 'key-c'])
        expect(String(call[0])).not.toContain(key);
    warnSpy.mockRestore();
  });

  describe('fallback model (owner 2026-11-24)', () => {
    const run = (failModel: string | null, status = 503) => {
      process.env.GEMINI_API_KEYS = 'key-a,key-b,key-c';
      const cache = redis();
      const manager = new GeminiCredentialManager(
        new GeminiModelRouter(),
        cache as any,
      );
      const models: string[] = [];
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const done = manager
        .execute({
          taskType: AiTaskType.TEXT_AUTHORING,
          operation: (model: any) => {
            models.push(model.model);
            return failModel === null || model.model.endsWith(failModel)
              ? Promise.reject(
                  Object.assign(new Error('high demand'), { status }),
                )
              : Promise.resolve('ok');
          },
        })
        .finally(() => warn.mockRestore());
      return { done, models, cache };
    };

    it('an overloaded main model on every key is answered by the fallback model', async () => {
      const { done, models } = run('gemini-3.5-flash-lite');
      await expect(done).resolves.toBe('ok');
      expect(
        models.filter((m) => m.endsWith('gemini-3.5-flash-lite')),
      ).toHaveLength(3);
      expect(models[models.length - 1]).toMatch(/gemini-3\.5-flash$/);
    });

    it('the main model resting on every key goes straight to the fallback', async () => {
      const first = run('gemini-3.5-flash-lite');
      await first.done;
      // Same cache: the main model rests on all keys, the fallback does not.
      process.env.GEMINI_API_KEYS = 'key-a,key-b,key-c';
      const manager = new GeminiCredentialManager(
        new GeminiModelRouter(),
        first.cache as any,
      );
      const models: string[] = [];
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      await expect(
        manager.execute({
          taskType: AiTaskType.TEXT_AUTHORING,
          operation: (model: any) => {
            models.push(model.model);
            return Promise.resolve('ok');
          },
        }),
      ).resolves.toBe('ok');
      warn.mockRestore();
      expect(models).toHaveLength(1);
      expect(models[0]).toMatch(/gemini-3\.5-flash$/);
    });

    it('a wrong request is not retried on another model', async () => {
      const { done, models } = run(null, 400);
      await expect(done).rejects.toThrow();
      expect(models).toHaveLength(1);
    });

    it('image generation has no fallback; a failing fallback model is the last word', () => {
      const router = new GeminiModelRouter();
      expect(
        router.fallbackFor(router.selectModel(AiTaskType.IMAGE_GENERATION)),
      ).toBeNull();
      expect(
        router.fallbackFor({
          taskType: AiTaskType.TEXT_AUTHORING,
          model: 'gemini-3.5-flash',
          capability: 'TEXT',
        })?.model,
      ).toBe('gemini-3.5-flash-lite');
      // The vision model (gemini-3.1-flash-lite) falls back to gemini-3.5-flash.
      expect(
        router.fallbackFor({
          taskType: AiTaskType.WRITING_PICTURE_EVALUATION,
          model: 'gemini-3.1-flash-lite',
          capability: 'VISION',
        })?.model,
      ).toBe('gemini-3.5-flash');
    });
  });

  describe('response deadline and ambiguous timeouts', () => {
    const manager = () =>
      new GeminiCredentialManager(new GeminiModelRouter(), redis() as any);
    const never = () => new Promise<string>(() => undefined);

    it('C/D. no response: one request, the signal is aborted, no other key is tried', async () => {
      let calls = 0;
      let aborted = false;
      await expect(
        manager().execute({
          taskType: AiTaskType.STRUCTURED_AUTHORING,
          timeoutMs: 20,
          failoverOnTimeout: false,
          operation: (_model, signal) => {
            calls += 1;
            signal.addEventListener('abort', () => (aborted = true));
            return never();
          },
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(calls).toBe(1);
      expect(aborted).toBe(true);
    });

    it('B. a slow response that arrives before the deadline is used', async () => {
      let calls = 0;
      await expect(
        manager().execute({
          taskType: AiTaskType.STRUCTURED_AUTHORING,
          timeoutMs: 200,
          failoverOnTimeout: false,
          operation: () => {
            calls += 1;
            return new Promise((resolve) =>
              setTimeout(() => resolve('late-ok'), 30),
            );
          },
        }),
      ).resolves.toBe('late-ok');
      expect(calls).toBe(1);
    });

    it('F. a definitive provider rejection (503) still fails over to another key', async () => {
      let calls = 0;
      await expect(
        manager().execute({
          taskType: AiTaskType.STRUCTURED_AUTHORING,
          timeoutMs: 200,
          failoverOnTimeout: false,
          operation: () => {
            calls += 1;
            return calls === 1
              ? Promise.reject(
                  Object.assign(new Error('unavailable'), { status: 503 }),
                )
              : Promise.resolve('ok');
          },
        }),
      ).resolves.toBe('ok');
      expect(calls).toBe(2);
    });

    it('callers that do not opt out keep the shared behaviour (a timeout tries the next key)', async () => {
      let calls = 0;
      await expect(
        manager().execute({
          taskType: AiTaskType.STRUCTURED_AUTHORING,
          timeoutMs: 20,
          operation: () => {
            calls += 1;
            return calls === 1 ? never() : Promise.resolve('ok');
          },
        }),
      ).resolves.toBe('ok');
      expect(calls).toBe(2);
    });
  });

  it('redacts keys and authorization values before logging', () => {
    const secret = 'AIza-not-for-logs';
    const value = redactGeminiError(
      `https://x.test?key=${secret} Authorization: Bearer token-value`,
    );
    expect(value).not.toContain(secret);
    expect(value).not.toContain('token-value');
  });
});
