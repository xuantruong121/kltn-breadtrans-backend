/**
 * Checkpoint 56: replace Grammar topics 1 and 2 without touching history.
 *
 * Topics 1-2 hold five ambiguous items (Q1, Q3, Q4, Q5, Q9) but already have
 * attempts, so GrammarService refuses to edit or delete their questions (409)
 * and GrammarQuestion has no retire flag. This script therefore uses only the
 * Admin domain methods that are allowed: it creates one new topic per original
 * (createTopic → createQuestion × 5 → publishTopic) with the corrected items
 * and the three unambiguous items copied verbatim, at the same catalog order.
 * Topics 1-2, their questions and attempts are not modified; they stay DRAFT,
 * so learners only receive the replacements while old results keep rendering
 * from the original rows.
 *
 * Usage: npx ts-node --transpile-only scripts/grammar-replace-cp56.ts <dryrun|apply> --target <url|env:DATABASE_URL>
 * apply needs GRAMMAR_REPLACE_AUTHORIZED=replace.
 */
import { PrismaClient } from '@prisma/client';

import { GRAMMAR_REPLACEMENTS } from '../prisma/data/grammar-replacements';
import { GrammarService } from '../src/modules/grammar/grammar.service';

type Item = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};
/** Expected current content of a question; anything else stops the run. */
type Expect = {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
};

const PLAN: Array<{
  originalId: number;
  title: string;
  expect: Expect[];
  replace: Record<number, Item>;
}> = [
  {
    originalId: 1,
    title: 'Present Simple & Adverbs of Frequency',
    expect: [
      {
        id: 1,
        question: 'The reception desk ______ at 8 A.M. every weekday.',
        options: ['opening', 'opened', 'open', 'opens'],
        correctIndex: 3,
      },
      {
        id: 2,
        question: 'We ______ check the inventory before placing a new order.',
        options: ['yesterday', 'ago', 'usually', 'last'],
        correctIndex: 2,
      },
      {
        id: 3,
        question: '______ your manager work from home on Fridays?',
        options: ['Does', 'Did', 'Do', 'Is'],
        correctIndex: 0,
      },
      {
        id: 4,
        question: 'My colleagues ______ lunch in the cafeteria most days.',
        options: ['had', 'having', 'have', 'has'],
        correctIndex: 2,
      },
      {
        id: 5,
        question: 'The train to the airport ______ every thirty minutes.',
        options: ['left', 'leaving', 'leave', 'leaves'],
        correctIndex: 3,
      },
    ],
    replace: GRAMMAR_REPLACEMENTS[0].corrections,
  },
  {
    originalId: 2,
    title: 'Past Simple & Time Expressions',
    expect: [
      {
        id: 6,
        question: 'The technician ______ the printer yesterday afternoon.',
        options: ['repaired', 'repairs', 'repair', 'repairing'],
        correctIndex: 0,
      },
      {
        id: 7,
        question: 'Did you ______ the customer this morning?',
        options: ['calling', 'call', 'calls', 'called'],
        correctIndex: 1,
      },
      {
        id: 8,
        question: 'We ______ the conference in Hanoi last year.',
        options: ['attending', 'attends', 'attended', 'attend'],
        correctIndex: 2,
      },
      {
        id: 9,
        question: 'The store ______ early because of the storm.',
        options: ['closed', 'has close', 'is closing', 'closes'],
        correctIndex: 0,
      },
      {
        id: 10,
        question: 'She ______ the final report two hours ago.',
        options: ['sends', 'has send', 'sent', 'send'],
        correctIndex: 2,
      },
    ],
    replace: GRAMMAR_REPLACEMENTS[1].corrections,
  },
];

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  const i = process.argv.indexOf('--target');
  const target = i > 0 ? process.argv[i + 1] : undefined;
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url || !['dryrun', 'apply'].includes(mode ?? ''))
    throw new Error('usage: <dryrun|apply> --target <url|env:DATABASE_URL>');
  if (mode === 'apply' && process.env.GRAMMAR_REPLACE_AUTHORIZED !== 'replace')
    throw new Error('REFUSED: GRAMMAR_REPLACE_AUTHORIZED=replace not set');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [{ db, sysid }] = await prisma.$queryRawUnsafe<any[]>(
      'select current_database() db, system_identifier::text sysid from pg_control_system()',
    );
    console.log(`target ${db} sysid ${sysid} (${mode})`);

    // Preflight: originals exactly as reviewed, still DRAFT, no replacement yet.
    for (const p of PLAN) {
      const topic = await prisma.grammarTopic.findUnique({
        where: { id: p.originalId },
        include: { questions: { orderBy: { order: 'asc' } } },
      });
      if (
        !topic ||
        topic.title !== p.title ||
        topic.publicationStatus !== 'DRAFT'
      )
        throw new Error(
          `STOP: topic ${p.originalId} is not the reviewed DRAFT topic`,
        );
      const got = JSON.stringify(
        topic.questions.map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
        })),
      );
      if (got !== JSON.stringify(p.expect))
        throw new Error(
          `STOP: topic ${p.originalId} questions differ from the review`,
        );
      const twins = await prisma.grammarTopic.count({
        where: { title: p.title, id: { not: p.originalId } },
      });
      if (twins > 0)
        throw new Error(
          `STOP: a topic titled "${p.title}" already exists besides ${p.originalId}`,
        );
    }

    // One transaction: a failure part-way leaves no half-built topic behind.
    // The service runs on the transaction client, so its own checks apply.
    const results = await prisma.$transaction(
      async (tx) => {
        const txService = new GrammarService(
          tx as unknown as typeof prisma,
          undefined as any,
          undefined as any,
        );
        const lines: string[] = [];
        for (const p of PLAN) {
          lines.push(await replaceTopic(tx, txService, p));
          // Test hook: prove the rollback on a disposable database only.
          if (
            process.env.GRAMMAR_REPLACE_TEST_FAIL === 'after-first' &&
            db !== 'kltn_db'
          )
            throw new Error('test failure after the first replacement');
        }
        return lines;
      },
      { timeout: 60_000 },
    );
    results.forEach((line) => console.log(line));
  } finally {
    await prisma.$disconnect();
  }
}

async function replaceTopic(
  tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  service: GrammarService,
  p: (typeof PLAN)[number],
) {
  const original = await tx.grammarTopic.findUniqueOrThrow({
    where: { id: p.originalId },
    include: { questions: { orderBy: { order: 'asc' } } },
  });
  const created = await service.createTopic({
    title: original.title,
    level: original.level,
    description: original.description ?? undefined,
    videoYoutubeId: original.videoYoutubeId ?? undefined,
    keyFormula: original.keyFormula ?? undefined,
    order: original.order,
  });
  for (const q of original.questions) {
    const item = p.replace[q.id] ?? {
      question: q.question,
      options: q.options as string[],
      correctIndex: q.correctIndex,
      explanation: q.explanation ?? '',
    };
    await service.createQuestion(created.id, {
      ...item,
      order: q.order,
    });
  }
  await service.publishTopic(created.id);
  return `topic ${p.originalId} → replacement ${created.id} PUBLISHED (${original.questions.length} questions, corrected: ${Object.keys(p.replace).join(', ')})`;
}

main().catch((e) => {
  console.error('STOPPED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
