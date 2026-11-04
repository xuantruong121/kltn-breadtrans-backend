/**
 * Measures what one TOEIC Part 5 solve request costs on each answer-review
 * provider and reasoning setting, with REAL provider calls (owner approved on
 * 2026-11-04). Prints status, token usage, latency and whether the reply is
 * valid JSON with the right answers. Never prints keys or account ids.
 *
 * Calls (6 at most):
 *   cloudflare messages (current client format)
 *   cloudflare responses, reasoning.effort = low / medium
 *   groq chat, reasoning_effort = low / medium
 *
 * Usage: npx ts-node --transpile-only scripts/ai-reasoning-probe.ts --live [--env <path>]
 */
import { config } from 'dotenv';

import { solvePrompt } from '../src/modules/ai/toeic-answer-review-prompt';
import { strictJsonSchema } from '../src/modules/ai/review/strict-json-schema';

const envPath = process.argv.includes('--env')
  ? process.argv[process.argv.indexOf('--env') + 1]
  : '../../Project/kltn-breadtrans-backend/.env';
config({ path: envPath, quiet: true } as any);

if (!process.argv.includes('--live')) {
  console.log('Refusing: pass --live to make real provider calls.');
  process.exit(1);
}

/** Original practice items, written for this probe; keys: 1, 2, 0. */
const groups = [
  {
    groupId: 'g1',
    questions: [
      {
        id: 'q1',
        text: 'The new printer is ------- faster than the old one.',
        options: ['very', 'much', 'more', 'most'],
      },
      {
        id: 'q2',
        text: 'Please submit your expense report ------- Friday at noon.',
        options: ['until', 'since', 'by', 'during'],
      },
      {
        id: 'q3',
        text: 'Ms. Tran asked her assistant to ------- the meeting room for Monday.',
        options: ['reserve', 'reserving', 'reserved', 'reservation'],
      },
    ],
  },
];
const KEY = { q1: 1, q2: 2, q3: 0 } as Record<string, number>;
const prompt = solvePrompt({ part: 5, groups });

type Result = {
  name: string;
  status: number | string;
  ms: number;
  usage: unknown;
  json: boolean;
  correct: string;
  note?: string;
};

function grade(text: string | null): { json: boolean; correct: string } {
  if (!text) return { json: false, correct: '-' };
  try {
    const data = JSON.parse(text);
    const items: any[] = data?.answers ?? data?.questions ?? data?.items ?? [];
    let ok = 0;
    for (const item of items)
      if (KEY[item.id ?? item.questionId] === item.choice) ok += 1;
    return { json: true, correct: `${ok}/3` };
  } catch {
    return { json: false, correct: '-' };
  }
}

async function post(url: string, auth: string, body: unknown) {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${auth}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const payload: any = await res.json().catch(() => null);
  return { status: res.status, ms: Date.now() - started, payload };
}

/** Text of a Responses-format output (message → output_text). */
function responsesText(result: any): string | null {
  if (typeof result?.output_text === 'string') return result.output_text;
  for (const item of result?.output ?? [])
    for (const part of item?.content ?? [])
      if (part?.type === 'output_text' && typeof part.text === 'string')
        return part.text;
  return null;
}

async function main() {
  const results: Result[] = [];
  const cfBase = `${process.env.CLOUDFLARE_AI_BASE_URL?.trim() || 'https://api.cloudflare.com/client/v4'}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID?.trim()}/ai/run/@cf/openai/gpt-oss-120b`;
  const cfKey = process.env.CLOUDFLARE_AI_API_TOKEN?.trim() ?? '';

  if (cfKey) {
    const r = await post(cfBase, cfKey, {
      messages: [
        { role: 'system', content: prompt.systemInstruction },
        { role: 'user', content: prompt.prompt },
      ],
      response_format: { type: 'json_schema', json_schema: prompt.schema },
      temperature: prompt.temperature,
      max_tokens: 8000,
    });
    const result = r.payload?.result;
    const text =
      result?.response ?? result?.choices?.[0]?.message?.content ?? null;
    results.push({
      name: 'cloudflare messages',
      status: r.status,
      ms: r.ms,
      usage: result?.usage ?? null,
      ...grade(typeof text === 'string' ? text : JSON.stringify(text)),
      note: `result keys: ${Object.keys(result ?? {}).join(',')}${r.payload?.errors?.[0]?.message ? ` error: ${r.payload.errors[0].message}` : ''}`,
    });

    for (const effort of ['low', 'medium']) {
      const resp = await post(cfBase, cfKey, {
        input: [
          { role: 'system', content: prompt.systemInstruction },
          { role: 'user', content: prompt.prompt },
        ],
        reasoning: { effort },
        text: {
          format: {
            type: 'json_schema',
            name: 'review',
            strict: true,
            schema: strictJsonSchema(prompt.schema),
          },
        },
      });
      const out = resp.payload?.result;
      results.push({
        name: `cloudflare responses effort=${effort}`,
        status: resp.status,
        ms: resp.ms,
        usage: out?.usage ?? null,
        ...grade(responsesText(out)),
        note: `result keys: ${Object.keys(out ?? {}).join(',')}${resp.payload?.errors?.[0]?.message ? ` error: ${resp.payload.errors[0].message}` : ''}`,
      });
    }
  }

  const groqBase = (process.env.AI_COMPAT_BASE_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  const groqKey = process.env.AI_COMPAT_API_KEY?.trim() ?? '';
  if (groqBase && groqKey) {
    for (const effort of ['low', 'medium']) {
      const r = await post(`${groqBase}/v1/chat/completions`, groqKey, {
        model: process.env.AI_COMPAT_MODEL?.trim() || 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: prompt.systemInstruction },
          { role: 'user', content: prompt.prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'review',
            strict: true,
            schema: strictJsonSchema(prompt.schema),
          },
        },
        temperature: prompt.temperature,
        reasoning_effort: effort,
        include_reasoning: false,
      });
      results.push({
        name: `groq effort=${effort}`,
        status: r.status,
        ms: r.ms,
        usage: r.payload?.usage ?? null,
        ...grade(r.payload?.choices?.[0]?.message?.content ?? null),
        note: r.payload?.error?.message,
      });
    }
  }

  for (const r of results) console.log(JSON.stringify(r));
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
