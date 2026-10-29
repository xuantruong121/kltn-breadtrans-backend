/**
 * Owner-authorized live check of the Writing Practice grading contract
 * (taskRelevance / relevanceEvidence, off-topic cap, length cap) against the
 * real configured Gemini model. No database, no Redis, no R2: the task
 * content comes from a JSON file, the answers are project-owned synthetic
 * texts, and nothing is persisted.
 *
 * Hard limits, enforced at the network boundary (globalThis.fetch):
 * - at most LIVE_GEMINI_BUDGET (<= 6) HTTP requests to the Gemini API in total,
 *   retries and key rotation included; past it the request never leaves;
 * - every request is sent with maxOutputTokens = OUTPUT_TOKEN_CAP and refused if
 *   its estimated input exceeds INPUT_TOKEN_CAP, so the cost is bounded.
 * Each case is graded once (no service-level retry). The run stops early after
 * two structurally invalid replies.
 *
 * Usage:
 *   LIVE_GEMINI_BUDGET=6 LIVE_TASKS=<tasks.json> LIVE_OUT=<results.json> \
 *   npx ts-node --transpile-only scripts/qa/writing-practice-live-gemini.ts
 * Reads only GEMINI_API_KEYS / GEMINI_API_KEY / GEMINI_MODEL_NAME from .env;
 * never prints them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';

import { GeminiEvaluatorStrategy } from '../../src/modules/ai/strategies/gemini-evaluator.strategy';
import {
  buildPracticeWritingRequest,
  countWords,
  practiceWritingTask,
  validatePracticeWritingResult,
} from '../../src/modules/writing/practice-writing-grading';

const BUDGET = Math.min(6, Number(process.env.LIVE_GEMINI_BUDGET ?? 0));
const OUTPUT_TOKEN_CAP = 3072;
const INPUT_TOKEN_CAP = 6000;
const PRICE_IN = 0.3 / 1e6;
const PRICE_OUT = 2.5 / 1e6;

const env = parse(readFileSync('.env'));
for (const key of ['GEMINI_API_KEYS', 'GEMINI_API_KEY', 'GEMINI_MODEL_NAME'])
  if (env[key]) process.env[key] = env[key];

let networkRequests = 0;
const usage: Array<Record<string, unknown>> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: unknown, init?: RequestInit) => {
  const url = String((input as { url?: string })?.url ?? input);
  if (!url.includes('generativelanguage.googleapis.com'))
    return realFetch(input as never, init);
  if (networkRequests >= BUDGET) throw new Error('LIVE_GEMINI_BUDGET_REACHED');
  const body = JSON.parse(String(init?.body ?? '{}'));
  const estimatedInput = Math.ceil(JSON.stringify(body).length / 3);
  if (estimatedInput > INPUT_TOKEN_CAP)
    throw new Error(`INPUT_TOO_LARGE_${estimatedInput}`);
  body.generationConfig = {
    ...(body.generationConfig ?? {}),
    maxOutputTokens: OUTPUT_TOKEN_CAP,
  };
  networkRequests += 1;
  const n = networkRequests;
  const response = await realFetch(input as never, {
    ...init,
    body: JSON.stringify(body),
  });
  try {
    const json = await response.clone().json();
    usage.push({
      n,
      status: response.status,
      model: json?.modelVersion ?? null,
      finishReason: json?.candidates?.[0]?.finishReason ?? null,
      usage: json?.usageMetadata ?? null,
    });
  } catch {
    usage.push({ n, status: response.status, usage: null });
  }
  return response;
};

type Case = { id: string; questionId: number; answer: string; expect: string };

async function main() {
  if (BUDGET < 1) throw new Error('Set LIVE_GEMINI_BUDGET (1-6)');
  // Constructed after the env is set: the credential manager reads it then.
  const gemini = new GeminiEvaluatorStrategy();
  const spec = JSON.parse(readFileSync(String(process.env.LIVE_TASKS), 'utf8'));
  const tasks: Record<
    string,
    { title: string; content: Record<string, unknown> }
  > = spec.tasks;
  const cases: Case[] = spec.cases;
  const results: Array<Record<string, unknown>> = [];
  let invalid = 0;
  for (const c of cases) {
    if (networkRequests >= BUDGET) break;
    if (invalid >= 2) {
      results.push({
        case: c.id,
        skipped: 'STOPPED_AFTER_TWO_INVALID_REPLIES',
      });
      continue;
    }
    const meta = tasks[String(c.questionId)];
    const task = practiceWritingTask(meta.content, meta.title)!;
    const request = buildPracticeWritingRequest(task, c.answer);
    const before = networkRequests;
    let raw: unknown = null;
    let error: string | null = null;
    try {
      const out = await gemini.generateStructuredJson({
        systemInstruction: request.systemInstruction,
        prompt: request.prompt,
        responseSchema: request.responseSchema,
        temperature: 0.2,
        // Same policy as WritingService practice grading.
        timeoutMs: 60_000,
        failoverOnTimeout: false,
      });
      raw = JSON.parse(out.text);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const verdict = raw
      ? validatePracticeWritingResult(raw, task, c.answer, request.facts)
      : null;
    if (!verdict?.ok) invalid += 1;
    results.push({
      case: c.id,
      questionId: c.questionId,
      taskType: task.taskType,
      level: meta.content.level ?? null,
      words: countWords(c.answer),
      length: request.facts.length,
      expect: c.expect,
      requests: networkRequests - before,
      error,
      valid: verdict ? verdict.ok : false,
      invalidReason: verdict && !verdict.ok ? verdict.reason : null,
      rawRelevance: (raw as any)?.taskRelevance ?? null,
      rawCriteria: (raw as any)?.criteria ?? null,
      result: verdict?.ok ? verdict.value : null,
    });
  }
  let tokensIn = 0;
  let tokensOut = 0;
  for (const u of usage) {
    const m = (u.usage ?? {}) as Record<string, number>;
    tokensIn += m.promptTokenCount ?? 0;
    tokensOut += (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0);
  }
  const summary = {
    budget: BUDGET,
    networkRequests,
    tokensIn,
    tokensOut,
    costUsd: Number((tokensIn * PRICE_IN + tokensOut * PRICE_OUT).toFixed(6)),
    worstCaseUsd: Number(
      (
        networkRequests *
        (INPUT_TOKEN_CAP * PRICE_IN + OUTPUT_TOKEN_CAP * PRICE_OUT)
      ).toFixed(6),
    ),
  };
  writeFileSync(
    String(process.env.LIVE_OUT),
    JSON.stringify({ summary, usage, results }, null, 2),
  );
  console.log(JSON.stringify(summary));
}

main().catch((e) => {
  console.error('LIVE_RUN_FAILED', e instanceof Error ? e.message : e);
  process.exit(1);
});
