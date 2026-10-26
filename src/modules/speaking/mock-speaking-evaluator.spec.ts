import { MockSpeakingEvaluator } from './mock-speaking-evaluator';

describe('MockSpeakingEvaluator.isMockEnabled', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it.each([
    [{ NODE_ENV: 'test' }, true],
    [{ NODE_ENV: 'development', MOCK_AZURE_SPEECH: 'true' }, true],
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'production', MOCK_AZURE_SPEECH: 'true' }, false],
  ])('%j -> %s', (env, expected) => {
    delete process.env.MOCK_AZURE_SPEECH;
    Object.assign(process.env, env);
    expect(MockSpeakingEvaluator.isMockEnabled()).toBe(expected);
  });
});
