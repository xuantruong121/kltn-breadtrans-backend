/**
 * Adds the English line to every Listening explanation (owner review
 * 2026-10-30: "cập nhật đầy đủ lời giải cho tao cả việt lẫn anh"). Every
 * Listening question already stores `explanation.vi`; none stores `en`, so
 * the learner check and the CMS checklist show it as missing.
 *
 * Modes (artifacts/listening-explanation-en/):
 *   generate  reads the questions from --source (read-only), one Gemini
 *             request per quiz, writes translations.json. Needs
 *             LISTENING_EN_GEMINI_AUTHORIZED=generate.
 *   apply     sets `explanation.en` on --target, only where `en` is still
 *             missing and `vi` is unchanged since generate; rollback file
 *             first. A non-harness target needs LISTENING_EN_APPLY_AUTHORIZED=apply.
 * Nothing else in the content changes, so recordings stay current (their
 * hash is built from the turns).
 *
 * Usage: npx ts-node --transpile-only scripts/listening-explanation-en.ts <mode> --source|--target <url|env:DATABASE_URL>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SchemaType } from '@google/generative-ai';
import { PrismaClient, QuizType } from '@prisma/client';

import { GeminiEvaluatorStrategy } from '../src/modules/ai/strategies/gemini-evaluator.strategy';

const DIR = join('artifacts', 'listening-explanation-en');
const FILE = join(DIR, 'translations.json');
const VI = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
const LETTER =
  /\b(option|answer|choice)\s+[A-D]\b|\([A-D]\)|\b[A-D]\s+is\s+(correct|right|wrong)/i;

type Translations = Record<string, { quizId: number; vi: string; en: string }>;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dbUrl = (name: string) => {
  const value = arg(name);
  const url = value === 'env:DATABASE_URL' ? process.env.DATABASE_URL : value;
  if (!url) throw new Error(`--${name} env:DATABASE_URL | <url> is required`);
  return url;
};
const explanationOf = (content: unknown) => {
  const c = (content ?? {}) as Record<string, any>;
  return c.explanation && typeof c.explanation === 'object'
    ? (c.explanation as Record<string, unknown>)
    : null;
};

async function listeningQuestions(prisma: PrismaClient) {
  const quizzes = await prisma.quiz.findMany({
    where: { type: QuizType.LISTENING_PRACTICE },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      questions: {
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: { id: true, type: true, content: true },
      },
    },
  });
  return quizzes.map((quiz) => ({
    ...quiz,
    pending: quiz.questions.filter((q) => {
      const e = explanationOf(q.content);
      return (
        !!e &&
        String(e.vi ?? '').trim() !== '' &&
        String(e.en ?? '').trim() === ''
      );
    }),
  }));
}

function prompt(quiz: Awaited<ReturnType<typeof listeningQuestions>>[number]) {
  const holder = quiz.questions.find((q) =>
    Array.isArray((q.content as any)?.transcriptSegments),
  );
  const turns: any[] = (holder?.content as any)?.transcriptSegments ?? [];
  const source = turns.length
    ? turns.map((t) => `${t.speaker ?? t.speakerId}: ${t.text}`).join('\n')
    : '(dictation: each item below is the sentence the learner hears)';
  const items = quiz.pending.map((q) => {
    const c = q.content as Record<string, any>;
    const e = explanationOf(c)!;
    return {
      id: q.id,
      question: c.prompt ?? c.text ?? c.correctAnswer,
      ...(Array.isArray(c.options)
        ? { correctAnswer: c.options[Number(c.correctIndex)] }
        : { sentence: c.correctAnswer ?? c.text }),
      vi: e.vi,
      ...(e.evidence ? { evidence: e.evidence } : {}),
    };
  });
  return [
    `English listening practice "${quiz.title}". Each item has a Vietnamese answer explanation (vi).`,
    'Write `en`: the same explanation in clear, natural English for a learner, faithful to vi, 1-2 sentences, based only on the source.',
    'Never name an option letter (A, B, C, D). Return one entry per id, same ids.',
    `Source:\n${source}`,
    `Items:\n${JSON.stringify(items, null, 1)}`,
  ].join('\n\n');
}

function check(ids: number[], result: any): string | null {
  const items: Array<{ id: number; en: string }> = result?.items ?? [];
  const got = new Set(items.map((i) => i.id));
  if (items.length !== ids.length || ids.some((id) => !got.has(id)))
    return 'ids do not match';
  const bad = items.find(
    (i) => !i.en?.trim() || VI.test(i.en) || LETTER.test(i.en),
  );
  return bad ? `item ${bad.id}: empty, Vietnamese or names a letter` : null;
}

async function generate() {
  if (process.env.LISTENING_EN_GEMINI_AUTHORIZED !== 'generate')
    throw new Error('REFUSED: needs LISTENING_EN_GEMINI_AUTHORIZED=generate');
  const prisma = new PrismaClient({
    datasources: { db: { url: dbUrl('source') } },
  });
  mkdirSync(DIR, { recursive: true });
  const done: Translations = existsSync(FILE)
    ? JSON.parse(readFileSync(FILE, 'utf8'))
    : {};
  const gemini = new GeminiEvaluatorStrategy() as any;
  let requests = 0;
  try {
    for (const quiz of await listeningQuestions(prisma)) {
      const todo = quiz.pending.filter((q) => !done[q.id]);
      if (!todo.length) continue;
      const ids = todo.map((q) => q.id);
      for (let attempt = 1; attempt <= 3; attempt++) {
        requests++;
        const response = await gemini.executeWithRotation((model: any) =>
          model.generateContent({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt({ ...quiz, pending: todo }) }],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: SchemaType.OBJECT,
                properties: {
                  items: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        id: { type: SchemaType.INTEGER },
                        en: { type: SchemaType.STRING },
                      },
                      required: ['id', 'en'],
                    },
                  },
                },
                required: ['items'],
              },
              temperature: 0.2,
            },
          }),
        );
        const result = JSON.parse(response.response.text());
        const issue = check(ids, result);
        if (issue) {
          console.log(`quiz ${quiz.id} attempt ${attempt}: ${issue}`);
          continue;
        }
        for (const item of result.items) {
          const vi = String(
            explanationOf(todo.find((q) => q.id === item.id)!.content)!.vi,
          );
          done[item.id] = { quizId: quiz.id, vi, en: item.en.trim() };
        }
        break;
      }
      writeFileSync(FILE, JSON.stringify(done, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(
    `${Object.keys(done).length} translations, ${requests} Gemini requests this run`,
  );
}

async function apply() {
  const url = dbUrl('target');
  const harness = /@127\.0\.0\.1:5460\//.test(url);
  if (!harness && process.env.LISTENING_EN_APPLY_AUTHORIZED !== 'apply')
    throw new Error(
      'REFUSED: non-harness target needs LISTENING_EN_APPLY_AUTHORIZED=apply',
    );
  const done: Translations = JSON.parse(readFileSync(FILE, 'utf8'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.question.findMany({
      where: { id: { in: Object.keys(done).map(Number) } },
      select: { id: true, content: true },
    });
    const rollback = join(
      DIR,
      `rollback-${harness ? 'harness' : 'target'}-${Date.now()}.json`,
    );
    writeFileSync(rollback, JSON.stringify(rows, null, 2));
    let updated = 0;
    let skipped = 0;
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const e = explanationOf(row.content);
        const t = done[row.id];
        if (!e || String(e.en ?? '').trim() || String(e.vi) !== t.vi) {
          skipped++;
          continue;
        }
        const content = row.content as Record<string, unknown>;
        await tx.question.update({
          where: { id: row.id },
          data: {
            content: {
              ...content,
              explanation: { ...e, en: t.en },
            },
          },
        });
        updated++;
      }
    });
    console.log(
      `${updated} updated, ${skipped} skipped (${harness ? 'harness' : 'AUTHORIZED target'}); rollback ${rollback}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  if (mode === 'generate') await generate();
  else if (mode === 'apply') await apply();
  else throw new Error('mode: generate | apply');
}

if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
