import {
  MODEL_PRICES,
  costRow,
  sumTelemetry,
  telemetryDays,
} from './provider-pricing';

describe('sumTelemetry', () => {
  it('sums the same provider and model across days', () => {
    const rows = sumTelemetry([
      {
        'openai-compatible|openai/gpt-oss-120b|requests': '3',
        'openai-compatible|openai/gpt-oss-120b|ok': '2',
        'openai-compatible|openai/gpt-oss-120b|unavailable': '1',
        'openai-compatible|openai/gpt-oss-120b|input_tokens': '1000',
        'openai-compatible|openai/gpt-oss-120b|output_tokens': '500',
      },
      {
        'openai-compatible|openai/gpt-oss-120b|requests': '1',
        'openai-compatible|openai/gpt-oss-120b|ok': '1',
        'openai-compatible|openai/gpt-oss-120b|latency_ms': '900',
      },
    ]);
    expect(rows).toEqual([
      {
        provider: 'openai-compatible',
        model: 'openai/gpt-oss-120b',
        requests: 4,
        ok: 3,
        invalid: 0,
        unavailable: 1,
        inputTokens: 1000,
        outputTokens: 500,
        latencyMs: 900,
        measuredNeurons: 0,
      },
    ]);
  });

  it('keeps a model id that contains slashes and ignores unknown metrics', () => {
    const [row] = sumTelemetry([
      {
        'cloudflare|@cf/openai/gpt-oss-120b|requests': '2',
        'cloudflare|@cf/openai/gpt-oss-120b|surprise': '9',
        broken: '1',
      },
    ]);
    expect(row.model).toBe('@cf/openai/gpt-oss-120b');
    expect(row.requests).toBe(2);
  });

  it('lists the busiest model first', () => {
    const rows = sumTelemetry([
      { 'gemini|a|requests': '1', 'cloudflare|b|requests': '5' },
    ]);
    expect(rows.map((r) => r.provider)).toEqual(['cloudflare', 'gemini']);
  });
});

describe('costRow', () => {
  const base = {
    requests: 1,
    ok: 1,
    invalid: 0,
    unavailable: 0,
    latencyMs: 0,
    measuredNeurons: 0,
  };

  it('prices Groq gpt-oss-120b at 0.15 / 0.60 USD per million tokens', () => {
    const row = costRow({
      ...base,
      provider: 'openai-compatible',
      model: 'openai/gpt-oss-120b',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(row.costUsd).toBeCloseTo(0.75);
    expect(row.neurons).toBeNull();
  });

  it('converts Cloudflare tokens to Neurons and Neurons to USD', () => {
    const row = costRow({
      ...base,
      provider: 'cloudflare',
      model: '@cf/openai/gpt-oss-120b',
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    // 3,181.8 + 6,818.2 = 10,000 Neurons, at 0.011 USD per 1,000.
    expect(row.neurons).toBe(10_000);
    expect(row.costUsd).toBeCloseTo(0.11);
  });

  it('prefers the Neurons Cloudflare reported over the estimate', () => {
    const [summed] = sumTelemetry([
      {
        'cloudflare|@cf/openai/gpt-oss-120b|ok': '2',
        'cloudflare|@cf/openai/gpt-oss-120b|input_tokens': '706',
        'cloudflare|@cf/openai/gpt-oss-120b|output_tokens': '602',
        'cloudflare|@cf/openai/gpt-oss-120b|neurons': '62.49',
      },
    ]);
    const row = costRow(summed);
    expect(row.neurons).toBe(62);
    expect(row.neuronsMeasured).toBe(true);
    expect(row.costUsd).toBeCloseTo((62.49 / 1000) * 0.011);
  });

  it('leaves the cost empty for a model with no price', () => {
    const row = costRow({
      ...base,
      provider: 'gemini',
      model: 'gemini-qa',
      inputTokens: 10,
      outputTokens: 10,
    });
    expect(row.costUsd).toBeNull();
    expect(row.label).toBeNull();
  });

  it('flags answers that came back without token counts', () => {
    const row = costRow({
      ...base,
      provider: 'cloudflare',
      model: '@cf/openai/gpt-oss-120b',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(row.tokensMissing).toBe(true);
    expect(row.costUsd).toBeNull();
    expect(row.neurons).toBeNull();
    expect(
      costRow({ ...row, ok: 0, unavailable: 1, requests: 1 }).tokensMissing,
    ).toBe(false);
  });

  it('records when every price was checked', () => {
    for (const price of Object.values(MODEL_PRICES))
      expect(price.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('telemetryDays', () => {
  it('lists UTC days, today first', () => {
    expect(telemetryDays(new Date('2026-11-04T01:00:00Z'), 3)).toEqual([
      '2026-11-04',
      '2026-11-03',
      '2026-11-02',
    ]);
  });
});
