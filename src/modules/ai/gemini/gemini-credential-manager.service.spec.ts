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
    // every warn call logs a fingerprint; none of them may equal another —
    // same credential must never be attempted twice within one call.
    for (const call of warnSpy.mock.calls) {
      const match = /key=([a-f0-9]{12})/.exec(String(call[0]));
      if (match) seenFingerprints.push(match[1]);
    }
    expect(seenFingerprints.length).toBe(3); // MAX_ATTEMPTS
    expect(new Set(seenFingerprints).size).toBe(3); // all distinct
    for (const call of warnSpy.mock.calls)
      for (const key of ['key-a', 'key-b', 'key-c'])
        expect(String(call[0])).not.toContain(key);
    warnSpy.mockRestore();
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
