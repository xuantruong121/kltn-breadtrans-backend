/**
 * F23A review fixes: questions with two defensible answers, one near-duplicate,
 * and dictionary examples that the F23A load kept from older entries. Grammar
 * goes through GrammarService, so a topic with learner attempts is refused.
 * Safe to run twice: rows that already match are skipped.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/f23-content-fixes.ts <dryrun|apply> --target <url|env:DATABASE_URL>
 * apply also needs F23_CONTENT_AUTHORIZED=apply.
 */
import { PrismaClient } from '@prisma/client';

import { GrammarService } from '../src/modules/grammar/grammar.service';
import {
  EXTRA_QUESTIONS,
  NEW_TOPICS,
  prepare,
} from './content/grammar-f23.data';
import { NEW_DECKS } from './content/vocab-f23.data';

/** Prompt in the database -> prompt in the data file. */
const QUESTIONS: [string, string][] = [
  [
    'They ______ a new office this month.',
    'They ______ a new office this month.',
  ],
  ['______ you call me tonight?', '______ you call me tonight?'],
  [
    'I ______ for you for two hours.',
    'I ______ for you for two hours, and you are still not here.',
  ],
  [
    "Don't call at 8; I ______ dinner then.",
    "Don't call at 8; I ______ dinner then.",
  ],
  [
    'At noon tomorrow, she ______ the clients.',
    'At noon tomorrow, she ______ the clients.',
  ],
  [
    'From 2 to 4 p.m. tomorrow, the manager ______ interviews.',
    'From 2 to 4 p.m. tomorrow, the manager ______ interviews.',
  ],
  [
    'In two hours, the team ______ the update.',
    'By this evening, the team ______ the update.',
  ],
  [
    'We ______ to Singapore next week; the tickets are booked.',
    'We ______ to Da Nang on Saturday; the hotel is booked.',
  ],
];

const WORDS = ['rain', 'sunny', 'seminar', 'applicant', 'insight'];

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  const i = process.argv.indexOf('--target');
  const target = i > 0 ? process.argv[i + 1] : undefined;
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url || !['dryrun', 'apply'].includes(mode ?? ''))
    throw new Error('usage: <dryrun|apply> --target <url|env:DATABASE_URL>');
  if (mode === 'apply' && process.env.F23_CONTENT_AUTHORIZED !== 'apply')
    throw new Error('REFUSED: F23_CONTENT_AUTHORIZED=apply not set');

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const write = mode === 'apply';
  try {
    const [{ db, sysid }] = await prisma.$queryRawUnsafe<any[]>(
      'select current_database() db, system_identifier::text sysid from pg_control_system()',
    );
    console.log(`target ${db} sysid ${sysid} mode ${mode}`);
    const service = new GrammarService(
      prisma as any,
      undefined as any,
      undefined as any,
    );
    const source = [
      ...NEW_TOPICS.flatMap((t) => t.questions),
      ...Object.values(EXTRA_QUESTIONS).flat(),
    ];

    let changed = 0;
    for (const [from, to] of QUESTIONS) {
      const raw = source.find((row) => row.q === to);
      if (!raw) throw new Error(`STOP: "${to}" is not in the data file`);
      const next = prepare(raw);
      const row = await prisma.grammarQuestion.findFirst({
        where: {
          question: { in: [from, to] },
          topic: { publicationStatus: 'PUBLISHED' },
        },
      });
      if (!row) throw new Error(`STOP: no question "${from}"`);
      const same =
        row.question === next.question &&
        JSON.stringify(row.options) === JSON.stringify(next.options) &&
        row.correctIndex === next.correctIndex &&
        row.explanation === next.explanation &&
        JSON.stringify(row.optionExplanations) ===
          JSON.stringify(next.optionExplanations);
      if (same) continue;
      changed += 1;
      console.log(`question #${row.id} "${from}" -> "${to}"`);
      if (write) await service.updateQuestion(row.topicId, row.id, next);
    }

    for (const headword of WORDS) {
      const word = NEW_DECKS.flatMap((d) => d.words).find(
        (w) => w.word.toLowerCase() === headword,
      );
      if (!word) throw new Error(`STOP: "${headword}" is not in the data file`);
      const entry = await prisma.dictionaryEntry.findUnique({
        where: { headword_pos: { headword, pos: word.pos } },
      });
      if (!entry) throw new Error(`STOP: no entry "${headword}"`);
      if (
        entry.exampleEn === word.exampleEn &&
        entry.exampleVi === word.exampleVi
      )
        continue;
      changed += 1;
      console.log(`entry #${entry.id} ${headword}: "${word.exampleEn}"`);
      if (write)
        await prisma.dictionaryEntry.update({
          where: { id: entry.id },
          data: { exampleEn: word.exampleEn, exampleVi: word.exampleVi },
        });
    }
    console.log(`${write ? 'changed' : 'would change'} ${changed}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
