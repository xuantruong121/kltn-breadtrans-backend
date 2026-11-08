/**
 * Prints the questions of a few Vocabulary Arena matches built from a
 * database's published decks, so a person can read them. Read only.
 *
 * Usage (harness clone, never the owner's database by default):
 *   npx ts-node --transpile-only scripts/qa/arena-question-sample.ts <matches> --target <url>
 */
import { PrismaClient } from '@prisma/client';

import {
  ARENA_ROUNDS,
  buildArenaQuestions,
  levelRank,
} from '../../src/modules/events/arena-questions.logic';

async function main() {
  const matches = Number(process.argv[2] ?? 2);
  const i = process.argv.indexOf('--target');
  const url = i > 0 ? process.argv[i + 1] : undefined;
  if (!url) throw new Error('usage: <matches> --target <url>');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const entries = await prisma.dictionaryEntry.findMany({
      where: {
        status: 'APPROVED',
        source: 'CURATED',
        deckWords: { some: { topic: { publicationStatus: 'PUBLISHED' } } },
      },
      include: {
        deckWords: {
          where: { topic: { publicationStatus: 'PUBLISHED' } },
          select: { topic: { select: { id: true, level: true } } },
        },
      },
    });
    const words = entries.map((e) => {
      const ranks = e.deckWords
        .map((d) => levelRank(d.topic.level))
        .filter((r): r is number => r !== null);
      return {
        id: e.id,
        headword: e.headword,
        displayWord: e.displayWord,
        pos: e.pos,
        meaningVi: e.meaningVi,
        exampleEn: e.exampleEn,
        ipa: e.ipaUs || e.ipaUk,
        level: ranks.length ? Math.min(...ranks) : null,
        topics: e.deckWords.map((d) => d.topic.id),
      };
    });
    const levelOf = new Map(words.map((w) => [w.id, w.level]));
    const names = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    console.log(`POOL=${words.length} deck words`);
    for (let m = 1; m <= matches; m += 1) {
      console.log(`\n=== Trận ${m}`);
      buildArenaQuestions(words, ARENA_ROUNDS, Math.random).forEach((q, n) => {
        const level = levelOf.get(q.id);
        console.log(
          `\nCâu ${n + 1} [${q.kind}, ${level ? names[level] : '?'}]${n === ARENA_ROUNDS - 1 ? ' ×2' : ''}`,
        );
        console.log(`  ${q.prompt}${q.ipa ? `  /${q.ipa}/` : ''}`);
        q.options.forEach((o, k) =>
          console.log(
            `  ${'ABCD'[k]}. ${o}${o === q.correctAnswer ? '   ✓' : ''}`,
          ),
        );
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
