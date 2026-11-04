/**
 * List prices for the answer-review models and the arithmetic that turns the
 * daily telemetry counters (`ai:answer-review:telemetry:<yyyy-mm-dd>`, written
 * by AnswerReviewService.count) into token totals and an estimated cost.
 *
 * Prices are what the provider charges on its paid tier, so the page can show
 * what the same traffic would cost after leaving the free tier. They are list
 * prices checked on `checkedOn`; recheck the provider page before relying on
 * them. A model missing here shows its tokens with no cost.
 */
export type ModelPrice = {
  label: string;
  inputUsdPerM: number;
  outputUsdPerM: number;
  /** Cloudflare bills in Neurons; these convert tokens to Neurons. */
  neuronsPerMInput?: number;
  neuronsPerMOutput?: number;
  checkedOn: string;
};

/** Cloudflare Workers Paid: USD per 1,000 Neurons above the free allocation. */
export const CLOUDFLARE_USD_PER_K_NEURONS = 0.011;
/** Neurons Cloudflare gives free each UTC day. */
export const CLOUDFLARE_FREE_NEURONS_PER_DAY = 10_000;

const cloudflare = (
  label: string,
  neuronsPerMInput: number,
  neuronsPerMOutput: number,
): ModelPrice => ({
  label,
  neuronsPerMInput,
  neuronsPerMOutput,
  inputUsdPerM: (neuronsPerMInput / 1000) * CLOUDFLARE_USD_PER_K_NEURONS,
  outputUsdPerM: (neuronsPerMOutput / 1000) * CLOUDFLARE_USD_PER_K_NEURONS,
  checkedOn: '2026-11-04',
});

/** Keyed by `<provider>|<model>`, the field prefix the telemetry uses. */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'cloudflare|@cf/openai/gpt-oss-120b': cloudflare(
    'Cloudflare gpt-oss-120b',
    31_818,
    68_182,
  ),
  'cloudflare|@cf/openai/gpt-oss-20b': cloudflare(
    'Cloudflare gpt-oss-20b',
    18_182,
    27_273,
  ),
  'openai-compatible|openai/gpt-oss-120b': {
    label: 'Groq gpt-oss-120b',
    inputUsdPerM: 0.15,
    outputUsdPerM: 0.6,
    checkedOn: '2026-11-04',
  },
  'gemini|gemini-3.5-flash-lite': {
    label: 'Gemini 3.5 Flash-Lite',
    inputUsdPerM: 0.3,
    outputUsdPerM: 2.5,
    checkedOn: '2026-11-04',
  },
  'gemini|gemini-2.5-flash': {
    label: 'Gemini 2.5 Flash',
    inputUsdPerM: 0.3,
    outputUsdPerM: 2.5,
    checkedOn: '2026-11-04',
  },
};

export type UsageRow = {
  provider: string;
  model: string;
  requests: number;
  ok: number;
  invalid: number;
  unavailable: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

const METRICS: Record<string, keyof UsageRow> = {
  requests: 'requests',
  ok: 'ok',
  invalid: 'invalid',
  unavailable: 'unavailable',
  input_tokens: 'inputTokens',
  output_tokens: 'outputTokens',
  latency_ms: 'latencyMs',
};

/**
 * Sums one or more telemetry hashes (field `<provider>|<model>|<metric>`)
 * into one row per provider and model. Unknown metrics are ignored.
 */
export function sumTelemetry(
  hashes: Array<Record<string, string>>,
): UsageRow[] {
  const rows = new Map<string, UsageRow>();
  for (const hash of hashes) {
    for (const [field, raw] of Object.entries(hash)) {
      const cut = field.lastIndexOf('|');
      const first = field.indexOf('|');
      if (cut <= first) continue;
      const metric = METRICS[field.slice(cut + 1)];
      if (!metric) continue;
      const provider = field.slice(0, first);
      const model = field.slice(first + 1, cut);
      const key = `${provider}|${model}`;
      const row = rows.get(key) ?? {
        provider,
        model,
        requests: 0,
        ok: 0,
        invalid: 0,
        unavailable: 0,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      };
      (row[metric] as number) += Number(raw) || 0;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.requests - a.requests);
}

export type CostRow = UsageRow & {
  label: string | null;
  /** Null when the model has no price entry. */
  costUsd: number | null;
  /** Cloudflare only. */
  neurons: number | null;
  /** Answers came back but the provider reported no token counts. */
  tokensMissing: boolean;
};

export function costRow(row: UsageRow): CostRow {
  const price = MODEL_PRICES[`${row.provider}|${row.model}`];
  const tokensMissing =
    row.ok + row.invalid > 0 && row.inputTokens + row.outputTokens === 0;
  return {
    ...row,
    label: price?.label ?? null,
    // Without token counts a cost of zero would be a claim, not a measure.
    costUsd:
      price && !tokensMissing
        ? (row.inputTokens * price.inputUsdPerM +
            row.outputTokens * price.outputUsdPerM) /
          1_000_000
        : null,
    neurons:
      !tokensMissing &&
      price?.neuronsPerMInput !== undefined &&
      price.neuronsPerMOutput !== undefined
        ? Math.round(
            (row.inputTokens * price.neuronsPerMInput +
              row.outputTokens * price.neuronsPerMOutput) /
              1_000_000,
          )
        : null,
    tokensMissing,
  };
}

/** The UTC day keys (yyyy-mm-dd) of the last `days` days, today first. */
export function telemetryDays(now: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++)
    out.push(
      new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10),
    );
  return out;
}
