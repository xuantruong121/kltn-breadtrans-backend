import { cloudflareUsage } from './cloudflare-workers-ai.client';

describe('cloudflareUsage', () => {
  it('reads chat-completion token names', () => {
    expect(
      cloudflareUsage({ usage: { prompt_tokens: 120, completion_tokens: 30 } }),
    ).toEqual({ inputTokens: 120, outputTokens: 30 });
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
