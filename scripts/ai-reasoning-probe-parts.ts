/**
 * Compares Cloudflare Workers AI (gpt-oss-120b) answer accuracy on real TOEIC
 * items of Parts 3, 4, 6 and 7 between the chat (messages) format and the
 * Responses format with reasoning.effort = low, with REAL provider calls
 * (owner approved on 2026-11-06). Also prints the raw `usage` object of each
 * reply so the token field names can be confirmed.
 *
 * Reads exam items only (no write). Never prints keys, tokens or account ids.
 * Calls: 2 per part, 8 in total.
 *
 * Usage: npx ts-node --transpile-only scripts/ai-reasoning-probe-parts.ts --live [--exam <id>] [--groups <n>]
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

import { solvePrompt } from '../src/modules/ai/toeic-answer-review-prompt';
import { strictJsonSchema } from '../src/modules/ai/review/strict-json-schema';
import { reviewItemId, solveRequestOf } from '../src/modules/toeic/toeic-answer-review.logic';

config({ path: '.env', quiet: true } as any);

if (!process.argv.includes('--live')) {
  console.log('Refusing: pass --live to make real provider calls.');
  process.exit(1);
}
const arg = (name: string) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const GROUPS_PER_PART = Number(arg('--groups') ?? 3);
const PARTS = [3, 4, 6, 7];

async function post(url: string, auth: string, body: unknown) {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  const payload: any = await res.json().catch(() => null);
  return { status: res.status, ms: Date.now() - started, payload };
}

function responsesText(result: any): string | null {
  if (typeof result?.output_text === 'string') return result.output_text;
  for (const item of result?.output ?? [])
    for (const part of item?.content ?? [])
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
  return null;
}

function grade(text: string | null, key: Record<string, number>) {
  if (!text) return { json: false, correct: 0, total: Object.keys(key).length };
  try {
    const data = JSON.parse(text);
    const items: any[] = data?.answers ?? data?.questions ?? data?.items ?? [];
    let ok = 0;
    for (const item of items) if (key[item.id ?? item.questionId] === item.choice) ok += 1;
    return { json: true, correct: ok, total: Object.keys(key).length };
  } catch {
    return { json: false, correct: 0, total: Object.keys(key).length };
  }
}

async function main() {
  const prisma = new PrismaClient();
  const cfBase = `${process.env.CLOUDFLARE_AI_BASE_URL?.trim() || 'https://api.cloudflare.com/client/v4'}/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID?.trim()}/ai/run/@cf/openai/gpt-oss-120b`;
  const cfKey = process.env.CLOUDFLARE_AI_API_TOKEN?.trim() ?? '';
  if (!cfKey || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Cloudflare credentials missing');

  const examId = arg('--exam')
    ? Number(arg('--exam'))
    : (
        await prisma.toeicQuestionGroup.findFirst({
          where: { part: 7 },
          orderBy: { examId: 'asc' },
          select: { examId: true },
        })
      )?.examId;
  if (!examId) throw new Error('No exam with Part 7 found');
  console.log(JSON.stringify({ examId, groupsPerPart: GROUPS_PER_PART }));

  const totals: Record<string, { correct: number; total: number }> = {};
  for (const part of PARTS) {
    const groups = await prisma.toeicQuestionGroup.findMany({
      where: { examId, part },
      orderBy: { groupOrder: 'asc' },
      take: GROUPS_PER_PART,
      include: { questions: { orderBy: { questionNumber: 'asc' } } },
    });
    if (!groups.length) continue;
    const rows = groups.map((g) => ({
      group: {
        transcript: g.transcriptText,
        passageText: g.passageText,
        imageBrief: g.imageBrief,
        questions: g.questions.map((q) => ({ text: q.text, options: q.options as any })),
      } as any,
      firstQuestionNumber: g.questions[0]?.questionNumber ?? 0,
    }));
    const key: Record<string, number> = {};
    for (const g of groups) for (const q of g.questions) key[reviewItemId(q.questionNumber)] = q.correctIndex;
    const prompt = solvePrompt(solveRequestOf(part, rows as any));

    const chat = await post(cfBase, cfKey, {
      messages: [
        { role: 'system', content: prompt.systemInstruction },
        { role: 'user', content: prompt.prompt },
      ],
      response_format: { type: 'json_schema', json_schema: prompt.schema },
      temperature: prompt.temperature,
      max_tokens: 8000,
    });
    const cr = chat.payload?.result;
    const chatText = cr?.response ?? cr?.choices?.[0]?.message?.content ?? null;
    const low = await post(cfBase, cfKey, {
      input: [
        { role: 'system', content: prompt.systemInstruction },
        { role: 'user', content: prompt.prompt },
      ],
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'review', strict: true, schema: strictJsonSchema(prompt.schema) } },
    });
    const lr = low.payload?.result;

    for (const [name, r, text] of [
      ['chat', chat, typeof chatText === 'string' ? chatText : chatText ? JSON.stringify(chatText) : null],
      ['responses-low', low, responsesText(lr)],
    ] as const) {
      const g = grade(text, key);
      const t = (totals[name] ??= { correct: 0, total: 0 });
      t.correct += g.correct;
      t.total += g.total;
      const result = (r as any).payload?.result;
      console.log(
        JSON.stringify({
          part,
          mode: name,
          status: (r as any).status,
          ms: (r as any).ms,
          json: g.json,
          correct: `${g.correct}/${g.total}`,
          usage: result?.usage ?? null,
          resultKeys: Object.keys(result ?? {}),
          error: (r as any).payload?.errors?.[0]?.message,
        }),
      );
    }
  }
  console.log(JSON.stringify({ totals }));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
