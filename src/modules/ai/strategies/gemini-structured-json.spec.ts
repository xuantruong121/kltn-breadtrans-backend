/**
 * Schema-constrained JSON generation used by Entry Diagnostic rubric grading.
 * The methods run against a fake `this`, so no Gemini client is built and no
 * request leaves the process.
 */
import { AiService } from '../ai.service';
import { AiTaskType } from '../gemini/gemini-model-router';
import { GeminiEvaluatorStrategy } from './gemini-evaluator.strategy';

const input = {
  systemInstruction: 'grade',
  prompt: 'response text',
  responseSchema: { type: 'object', properties: {} },
};

describe('GeminiEvaluatorStrategy.generateStructuredJson', () => {
  const run = (self: Record<string, unknown>, args = input) =>
    GeminiEvaluatorStrategy.prototype.generateStructuredJson.call(
      self as never,
      args,
    );

  it('throws PROVIDER_NOT_CONFIGURED instead of returning a fallback when no key is set', async () => {
    const executeWithRotation = jest.fn();
    await expect(
      run({ hasKeys: () => false, executeWithRotation }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
    expect(executeWithRotation).not.toHaveBeenCalled();
  });

  it('requests JSON with the given schema, no persona, as structured authoring', async () => {
    const generateContent = jest.fn(() =>
      Promise.resolve({
        response: { text: () => '{"ok":true}', usageMetadata: {} },
      }),
    );
    const recordUsage = jest.fn();
    let taskType: unknown;
    const self = {
      hasKeys: () => true,
      recordUsage,
      executeWithRotation: (op: (m: unknown) => unknown, t: unknown) => {
        taskType = t;
        return op({ model: 'models/fake', generateContent });
      },
    };
    await expect(
      run(self, { ...input, temperature: 0.1 } as never),
    ).resolves.toEqual({
      text: '{"ok":true}',
      model: 'models/fake',
    });
    expect(taskType).toBe(AiTaskType.STRUCTURED_AUTHORING);
    expect(generateContent).toHaveBeenCalledWith({
      systemInstruction: 'grade',
      contents: [{ role: 'user', parts: [{ text: 'response text' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: input.responseSchema,
        temperature: 0.1,
      },
    });
    expect(JSON.stringify(generateContent.mock.calls)).not.toMatch(/Bánh Mì/);
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });

  it('propagates provider errors rather than swallowing them', async () => {
    const failure = Object.assign(new Error('quota'), { status: 429 });
    await expect(
      run({
        hasKeys: () => true,
        recordUsage: jest.fn(),
        executeWithRotation: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);
  });
});

describe('AiService.generateStructuredJson', () => {
  it('delegates to the strategy', async () => {
    const generateStructuredJson = jest.fn(() =>
      Promise.resolve({ text: '{}', model: 'm' }),
    );
    const service = new AiService({ generateStructuredJson } as never);
    await expect(service.generateStructuredJson(input)).resolves.toEqual({
      text: '{}',
      model: 'm',
    });
    expect(generateStructuredJson).toHaveBeenCalledWith(input);
  });

  it('fails as not configured when the strategy cannot do structured output', async () => {
    const service = new AiService({} as never);
    await expect(service.generateStructuredJson(input)).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  });
});
