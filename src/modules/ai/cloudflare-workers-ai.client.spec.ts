import {
  cloudflareReasoningEffort,
  cloudflareResponsesText,
  cloudflareUsage,
} from './cloudflare-workers-ai.client';

describe('cloudflareUsage', () => {
  it('reads chat-completion token names and the billed Neurons', () => {
    // Shape seen live on 2026-11-04 (scripts/ai-reasoning-probe.ts).
    expect(
      cloudflareUsage({
        usage: {
          prompt_tokens: 353,
          completion_tokens: 701,
          total_tokens: 1054,
          neurons: 59.02719497680664,
        },
      }),
    ).toEqual({
      inputTokens: 353,
      outputTokens: 701,
      neurons: 59.02719497680664,
    });
  });

  it('reads Responses-format token names', () => {
    expect(
      cloudflareUsage({ usage: { input_tokens: 80, output_tokens: 20 } }),
    ).toEqual({ inputTokens: 80, outputTokens: 20 });
  });

  it('returns nothing when the reply has no usable counts', () => {
    expect(cloudflareUsage({ response: '{}' })).toBeUndefined();
    expect(cloudflareUsage({ usage: {} })).toBeUndefined();
    expect(cloudflareUsage(null)).toBeUndefined();
  });
});

describe('cloudflareResponsesText', () => {
  it('skips the reasoning item and returns the output text', () => {
    expect(
      cloudflareResponsesText({
        output: [
          {
            type: 'reasoning',
            content: [{ type: 'reasoning_text', text: 'hmm' }],
          },
          {
            type: 'message',
            content: [{ type: 'output_text', text: '{"answers":[]}' }],
          },
        ],
      }),
    ).toBe('{"answers":[]}');
  });

  it('throws on an empty reply', () => {
    expect(() => cloudflareResponsesText({ output: [] })).toThrow();
  });
});

describe('cloudflareReasoningEffort', () => {
  const saved = process.env.CLOUDFLARE_AI_REASONING_EFFORT;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLOUDFLARE_AI_REASONING_EFFORT;
    else process.env.CLOUDFLARE_AI_REASONING_EFFORT = saved;
  });

  it('accepts low, medium and high only', () => {
    process.env.CLOUDFLARE_AI_REASONING_EFFORT = ' Low ';
    expect(cloudflareReasoningEffort()).toBe('low');
    process.env.CLOUDFLARE_AI_REASONING_EFFORT = 'max';
    expect(cloudflareReasoningEffort()).toBeNull();
    delete process.env.CLOUDFLARE_AI_REASONING_EFFORT;
    expect(cloudflareReasoningEffort()).toBeNull();
  });
});
