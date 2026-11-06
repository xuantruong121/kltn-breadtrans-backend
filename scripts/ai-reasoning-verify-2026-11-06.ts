/**
 * Full check of CLOUDFLARE_AI_REASONING_EFFORT low against medium, owner
 * approved real calls on 2026-11-06. The 2026-11-04 probe asked for "a full
 * L&R run with each setting" before moving to low; this is that run, plus the
 * other job the setting drives: Cloudflare as stand-in exam generator.
 *
 *   solve     exam 3, Parts 2-7, one call per Part as in production
 *             (toeic-ai-exam.service.ts runs solveRequestOf over all groups
 *             of a Part). Part 1 is reviewed by vision and is not affected.
 *             Graphic groups take their GRAPHIC passage from batch C data,
 *             i.e. the state after the pending graphic correction.
 *   generate  one Part 3 batch (a three-speaker group and a graphic group)
 *             and one Part 7 triple-passage group per setting, checked with
 *             the production validators.
 *
 * Calls go through CloudflareWorkersAiClient.generateJsonDetailed, the
 * production path; the effort is switched with the environment variable it
 * reads on every call. DB is only read. No key or account id is printed.
 *
 * Usage: npx ts-node --transpile-only scripts/ai-reasoning-verify-2026-11-06.ts --live
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import { CloudflareWorkersAiClient } from '../src/modules/ai/cloudflare-workers-ai.client';
import { solvePrompt } from '../src/modules/ai/toeic-answer-review-prompt';
import { assertToeicBatchShape, toeicBatchRequest } from '../src/modules/ai/toeic-exam-prompt';
import {
  isVietnameseExplanation,
  languageIssue,
  plannedGroupIssue,
  questionContentIssue,
  readingGroupIssue,
} from '../src/modules/toeic/toeic-ai-batch.logic';
import { reviewItemId, solveRequestOf } from '../src/modules/toeic/toeic-answer-review.logic';
import { listeningScriptLengthIssue } from '../src/modules/toeic/toeic-listening-length';
import { C_GROUPS } from './toeic-content-fix-c-2026-11-06.data';

if (!process.argv.includes('--live')) {
  console.log('Refusing: pass --live to make real provider calls.');
  process.exit(1);
}
const EXAM = 3;
const MODES = ['low', 'medium'] as const;
// Same format as scripts/toeic-content-fix-c-graphic-passage-2026-11-06.ts
// (importing it would run that script).
const graphicPassage = (g: { title: string; columns: string[]; rows: string[][] }) =>
  [`GRAPHIC: ${g.title}`, g.columns.join(' | '), ...g.rows.map((r) => r.join(' | '))].join('\n');
const graphicFor = new Map(C_GROUPS.filter((g) => g.graphic).map((g) => [g.groupId, graphicPassage(g.graphic!)]));

async function timed<T>(fn: () => Promise<T>) {
  const t = Date.now();
  try {
    return { ok: true as const, value: await fn(), ms: Date.now() - t };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message.slice(0, 200) : String(error), ms: Date.now() - t };
  }
}

async function main() {
  const prisma = new PrismaClient();
  const client = new CloudflareWorkersAiClient();
  if (!client.configured()) throw new Error('Cloudflare credentials missing');
  const out: any = { exam: EXAM, solve: [], generate: [] };

  for (const part of [2, 3, 4, 5, 6, 7]) {
    const groups = await prisma.toeicQuestionGroup.findMany({
      where: { examId: EXAM, part },
      orderBy: { groupOrder: 'asc' },
      include: { questions: { orderBy: { questionNumber: 'asc' } } },
    });
    const rows = groups.map((g) => ({
      group: {
        transcript: g.transcriptText,
        passageText: graphicFor.get(g.id) ?? g.passageText,
        imageBrief: g.imageBrief,
        questions: g.questions.map((q) => ({ text: q.text, options: q.options as any })),
      } as any,
      firstQuestionNumber: g.questions[0]?.questionNumber ?? 0,
    }));
    const key = new Map<string, number>();
    const graphicIds = new Set<string>();
    for (const g of groups)
      for (const q of g.questions) {
        key.set(reviewItemId(q.questionNumber), q.correctIndex);
        if (/look at the graphic/i.test(q.text)) graphicIds.add(reviewItemId(q.questionNumber));
      }
    const prompt = solvePrompt(solveRequestOf(part, rows));
    for (const mode of MODES) {
      process.env.CLOUDFLARE_AI_REASONING_EFFORT = mode;
      const r = await timed(() =>
        client.generateJsonDetailed({ systemInstruction: prompt.systemInstruction, prompt: prompt.prompt, schema: prompt.schema, temperature: prompt.temperature }),
      );
      const answers: any[] = r.ok ? ((r.value.data as any)?.answers ?? []) : [];
      const wrong = answers.filter((a) => key.get(a.id) !== a.choice).map((a) => a.id);
      const missing = [...key.keys()].filter((id) => !answers.some((a) => a.id === id));
      const row = {
        part, mode, ok: r.ok, ms: r.ms, error: r.ok ? undefined : r.error,
        total: key.size, correct: answers.filter((a) => key.get(a.id) === a.choice).length,
        wrong, missing, graphicWrong: wrong.filter((id) => graphicIds.has(id)),
        neurons: r.ok ? r.value.usage?.neurons : undefined,
      };
      out.solve.push(row);
      console.log(JSON.stringify(row));
    }
  }

  const plans = [
    { part: 3, difficulty: 'medium' as const, topic: 'workplace and services', groups: [{ questionCount: 3, threeSpeakers: true }, { questionCount: 3, graphic: true }] },
    { part: 7, difficulty: 'medium' as const, topic: 'business correspondence', groups: [{ questionCount: 5, kind: 'MULTIPLE' as const, documents: 3 as const }] },
  ];
  for (const plan of plans)
    for (const mode of MODES) {
      process.env.CLOUDFLARE_AI_REASONING_EFFORT = mode;
      const request = toeicBatchRequest(plan as any);
      const r = await timed(() => client.generateJsonDetailed({ ...(request as any) }));
      const issues: string[] = [];
      if (r.ok) {
        try {
          const batch = assertToeicBatchShape(r.value.data as any, plan as any);
          batch.groups.forEach((g: any, i: number) => {
            const planned = plan.groups[i] as any;
            for (const issue of [
              plannedGroupIssue(planned, g),
              languageIssue(g),
              questionContentIssue(plan.part, g),
              readingGroupIssue(plan.part, g),
              plan.part <= 4 ? listeningScriptLengthIssue(plan.part, g.transcript) : null,
            ])
              if (issue) issues.push(`group ${i + 1}: ${issue}`);
            for (const q of g.questions ?? []) {
              if (!Array.isArray(q.options) || q.options.length !== 4) issues.push(`group ${i + 1}: options`);
              if (!(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4)) issues.push(`group ${i + 1}: key`);
              if (!isVietnameseExplanation(q.explanation)) issues.push(`group ${i + 1}: explanation not Vietnamese`);
            }
          });
        } catch (error) {
          issues.push(error instanceof Error ? error.message : String(error));
        }
      }
      const row = { part: plan.part, mode, ok: r.ok, ms: r.ms, error: r.ok ? undefined : r.error, issues, neurons: r.ok ? r.value.usage?.neurons : undefined };
      out.generate.push(row);
      console.log(JSON.stringify(row));
    }

  writeFileSync('artifacts/ai-reasoning-verify-2026-11-06.json', JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
