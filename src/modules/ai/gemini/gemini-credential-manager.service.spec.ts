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

  it('redacts keys and authorization values before logging', () => {
    const secret = 'AIza-not-for-logs';
    const value = redactGeminiError(
      `https://x.test?key=${secret} Authorization: Bearer token-value`,
    );
    expect(value).not.toContain(secret);
    expect(value).not.toContain('token-value');
  });
});
