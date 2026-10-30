/**
 * Rewrites the Part 3 conversations and Part 4 talks of one TOEIC L&R exam set
 * at real-test length (toeic-listening-length.ts). Owner decision 2026-10-30:
 * exam 1's 35-word dialogues made a 33-minute Listening section.
 *
 * Group ids, group order and question numbers stay; only the spoken script,
 * question text, options, key and explanation change. Audio is regenerated
 * afterwards by materialize-exam1-listening-phase0.ts (the script hash changes),
 * then the master by toeic-listening-master.ts.
 *
 * Modes (files under artifacts/toeic-rewrite-34/exam-<id>/):
 *   plan      read-only: current word counts and the request estimate.
 *   generate  Gemini, in batches of up to 5 groups; every group is validated
 *             (length, 3 spoken questions, 4 distinct options, key,
 *             explanation, composable audio script) and a batch is retried
 *             at most twice. Writes candidate.json. Needs
 *             TOEIC_REWRITE_GEMINI_AUTHORIZED=generate.
 *   apply     writes candidate.json to --target in one transaction, after
 *             saving rollback.json. Refuses when the exam has attempts unless
 *             --allow-attempts; refuses a non-harness database unless
 *             TOEIC_REWRITE_APPLY_AUTHORIZED=apply.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/toeic-rewrite-listening-34.ts <mode> --exam 1 --target <url|env:DATABASE_URL>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

import { GeminiEvaluatorStrategy } from '../src/modules/ai/strategies/gemini-evaluator.strategy';
import type { ToeicExamBatchGroup } from '../src/modules/ai/strategies/ai-evaluator.interface';
import { buildToeicListeningAudioScript } from '../src/modules/toeic/toeic-listening-audio';
import {
  listeningScriptLengthIssue,
  spokenWordCount,
} from '../src/modules/toeic/toeic-listening-length';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const BATCH = 5;
const ATTEMPTS = 3;
/** Varied settings so a batch does not repeat one office scene. */
const TOPICS: Record<number, string[]> = {
  3: [
    'office scheduling, equipment and project deadlines',
    'retail store, restaurant and customer orders',
    'travel bookings, hotels and transport delays',
    'hiring, training and workplace policies',
  ],
  4: [
    'company announcements and meeting excerpts',
    'voicemail and telephone messages',
    'radio broadcasts, advertisements and tours',
  ],
};

type CandidateGroup = {
  groupId: number;
  part: number;
  groupOrder: number;
  questionNumbers: number[];
  transcript: string;
  words: number;
  questions: Array<{
    text: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
};

function targetUrl() {
  const target = arg('target');
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url) throw new Error('--target env:DATABASE_URL | <url> is required');
  return url;
}

async function loadGroups(prisma: PrismaClient, examId: number) {
  return prisma.toeicQuestionGroup.findMany({
    where: { examId, part: { in: [3, 4] } },
    orderBy: [{ part: 'asc' }, { groupOrder: 'asc' }],
    select: {
      id: true,
      part: true,
      groupOrder: true,
      transcriptText: true,
      passageText: true,
      questions: {
        orderBy: { questionNumber: 'asc' },
        select: {
          id: true,
          questionNumber: true,
          text: true,
          options: true,
          correctIndex: true,
          explanation: true,
        },
      },
    },
  });
}

/** Null when the generated group can be published, otherwise why not. */
export function groupIssue(
  part: number,
  questionCount: number,
  group: ToeicExamBatchGroup,
): string | null {
  const transcript = String(group?.transcript ?? '').trim();
  const length = listeningScriptLengthIssue(part, transcript);
  if (length) return length;
  if (
    !Array.isArray(group.questions) ||
    group.questions.length !== questionCount
  )
    return `expected ${questionCount} questions`;
  for (const q of group.questions) {
    const options = (q.options ?? []).map((o) => String(o ?? '').trim());
    if (!String(q.text ?? '').trim()) return 'question without spoken text';
    if (
      options.length !== 4 ||
      options.some((o) => !o) ||
      new Set(options.map((o) => o.toLowerCase())).size !== 4
    )
      return 'options are not 4 distinct answers';
    if (
      !Number.isInteger(q.correctIndex) ||
      q.correctIndex < 0 ||
      q.correctIndex > 3
    )
      return 'invalid correctIndex';
    if (String(q.explanation ?? '').trim().length < 20)
      return 'explanation too short';
  }
  try {
    buildToeicListeningAudioScript({
      part,
      transcriptText: transcript,
      passageText: null,
      questions: group.questions,
    });
  } catch (error) {
    return (error as Error).message;
  }
  return null;
}

async function plan(examId: number) {
  const prisma = new PrismaClient({
    datasources: { db: { url: targetUrl() } },
  });
  const groups = await loadGroups(prisma, examId);
  await prisma.$disconnect();
  for (const part of [3, 4]) {
    const list = groups.filter((g) => g.part === part);
    const words = list.map((g) =>
      spokenWordCount(g.transcriptText || g.passageText || ''),
    );
    console.log(
      `Part ${part}: ${list.length} groups, ${list.reduce((n, g) => n + g.questions.length, 0)} questions, words min ${Math.min(...words)} avg ${Math.round(words.reduce((a, b) => a + b, 0) / words.length)} max ${Math.max(...words)}; ${Math.ceil(list.length / BATCH)} Gemini requests (at most ${Math.ceil(list.length / BATCH) * ATTEMPTS} with retries)`,
    );
  }
}

async function generate(examId: number, dir: string) {
  if (process.env.TOEIC_REWRITE_GEMINI_AUTHORIZED !== 'generate')
    throw new Error(
      'REFUSED: TOEIC_REWRITE_GEMINI_AUTHORIZED=generate not set',
    );
  const prisma = new PrismaClient({
    datasources: { db: { url: targetUrl() } },
  });
  const groups = await loadGroups(prisma, examId);
  await prisma.$disconnect();
  const gemini = new GeminiEvaluatorStrategy();
  const out: CandidateGroup[] = [];
  const seen = new Set<string>();
  let requests = 0;
  for (const part of [3, 4]) {
    const list = groups.filter((g) => g.part === part);
    for (let start = 0; start < list.length; start += BATCH) {
      const chunk = list.slice(start, start + BATCH);
      const topic = TOPICS[part][(start / BATCH) % TOPICS[part].length];
      let accepted: CandidateGroup[] | null = null;
      for (let attempt = 1; attempt <= ATTEMPTS && !accepted; attempt++) {
        requests++;
        const batch = await gemini.generateToeicExamBatch({
          part,
          topic,
          difficulty: 'medium',
          groups: chunk.map((g) => ({
            questionCount: g.questions.length,
            kind: 'MULTIPLE' as const,
          })),
        });
        const issues = batch.groups.map((g, i) => {
          const issue = groupIssue(part, chunk[i].questions.length, g);
          const opening = String(g.transcript ?? '')
            .slice(0, 80)
            .toLowerCase();
          return issue ?? (seen.has(opening) ? 'duplicate script' : null);
        });
        if (issues.some(Boolean)) {
          console.log(
            `Part ${part} groups ${chunk[0].groupOrder}-${chunk[chunk.length - 1].groupOrder} attempt ${attempt}: ${issues.filter(Boolean).join('; ')}`,
          );
          continue;
        }
        accepted = batch.groups.map((g, i) => ({
          groupId: chunk[i].id,
          part,
          groupOrder: chunk[i].groupOrder,
          questionNumbers: chunk[i].questions.map((q) => q.questionNumber),
          transcript: String(g.transcript).trim(),
          words: spokenWordCount(String(g.transcript)),
          questions: g.questions.map((q) => ({
            text: String(q.text).trim(),
            options: q.options.map((o) => String(o).trim()),
            correctIndex: q.correctIndex,
            explanation: String(q.explanation).trim(),
          })),
        }));
      }
      if (!accepted)
        throw new Error(
          `Part ${part} batch at group ${chunk[0].groupOrder} failed ${ATTEMPTS} times; candidate.json not written`,
        );
      for (const g of accepted)
        seen.add(g.transcript.slice(0, 80).toLowerCase());
      out.push(...accepted);
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'candidate.json'),
    JSON.stringify(
      { examId, generatedAt: new Date().toISOString(), requests, groups: out },
      null,
      2,
    ),
  );
  console.log(
    `candidate.json: ${out.length} groups, ${requests} Gemini requests, words avg ${Math.round(out.reduce((n, g) => n + g.words, 0) / out.length)}`,
  );
}

async function apply(examId: number, dir: string) {
  const url = targetUrl();
  const harness = /@127\.0\.0\.1:5460\//.test(url);
  if (!harness && process.env.TOEIC_REWRITE_APPLY_AUTHORIZED !== 'apply')
    throw new Error(
      'REFUSED: non-harness target needs TOEIC_REWRITE_APPLY_AUTHORIZED=apply',
    );
  const file = join(dir, 'candidate.json');
  if (!existsSync(file)) throw new Error(`${file} missing: run generate first`);
  const candidate = JSON.parse(readFileSync(file, 'utf8'));
  if (candidate.examId !== examId)
    throw new Error('candidate is for another exam');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const attempts = await prisma.toeicAttempt.count({ where: { examId } });
    if (attempts && !process.argv.includes('--allow-attempts'))
      throw new Error(
        `REFUSED: exam ${examId} has ${attempts} attempts whose review would show the new content; pass --allow-attempts`,
      );
    const groups = await loadGroups(prisma, examId);
    const byId = new Map(groups.map((g) => [g.id, g]));
    for (const c of candidate.groups as CandidateGroup[]) {
      const g = byId.get(c.groupId);
      if (!g || g.part !== c.part)
        throw new Error(`group ${c.groupId} not found`);
      if (
        JSON.stringify(g.questions.map((q) => q.questionNumber)) !==
        JSON.stringify(c.questionNumbers)
      )
        throw new Error(`group ${c.groupId} question numbers changed`);
      const issue = groupIssue(c.part, c.questionNumbers.length, c);
      if (issue) throw new Error(`group ${c.groupId}: ${issue}`);
    }
    const rollback = join(dir, `rollback-${Date.now()}.json`);
    writeFileSync(rollback, JSON.stringify({ examId, groups }, null, 2));
    await prisma.$transaction(async (tx) => {
      for (const c of candidate.groups as CandidateGroup[]) {
        await tx.toeicQuestionGroup.update({
          where: { id: c.groupId },
          data: { transcriptText: c.transcript, passageText: null },
        });
        const questions = byId.get(c.groupId)!.questions;
        for (const [i, q] of c.questions.entries())
          await tx.toeicQuestion.update({
            where: { id: questions[i].id },
            data: {
              text: q.text,
              options: q.options,
              correctIndex: q.correctIndex,
              explanation: q.explanation,
            },
          });
      }
    });
    console.log(
      `applied ${candidate.groups.length} groups to exam ${examId} (${harness ? 'harness' : 'AUTHORIZED target'}); rollback ${rollback}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  const examId = Number(arg('exam') ?? 1);
  const dir = join('artifacts', 'toeic-rewrite-34', `exam-${examId}`);
  if (mode === 'plan') await plan(examId);
  else if (mode === 'generate') await generate(examId, dir);
  else if (mode === 'apply') await apply(examId, dir);
  else throw new Error('mode: plan | generate | apply');
}

if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
