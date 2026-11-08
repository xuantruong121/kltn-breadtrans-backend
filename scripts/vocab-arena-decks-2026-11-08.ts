/**
 * Owner request 2026-11-08: more words for the Vocabulary Arena, which takes
 * every word of the published decks. Adds the ten decks of
 * scripts/content/vocab-arena-2026-11-08.data.ts (4 B1, 6 B2, mostly verbs and
 * adjectives), the same way scripts/f23-grammar-vocab-content.ts added its
 * decks: a word already in the dictionary (same headword and part of speech)
 * is reused, a deck whose title exists is skipped. Safe to run twice.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/vocab-arena-decks-2026-11-08.ts <dryrun|apply> --target <url|env:DATABASE_URL>
 * dryrun writes nothing. apply needs VOCAB_ARENA_AUTHORIZED=apply.
 * Take a backup (npm run db:backup) before apply on kltn_db.
 * Audio is separate: scripts/generate-vocab-accent-audio.ts.
 */
import { PrismaClient } from '@prisma/client';

import {
  blankedExample,
  isDuelWord,
  meaningsClash,
} from '../src/modules/events/arena-questions.logic';
import { ARENA_DECKS } from './content/vocab-arena-2026-11-08.data';
import type { RawWord } from './content/vocab-f23.data';

const WORDS_PER_DECK = 12;

function checkContent(): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const deck of ARENA_DECKS) {
    if (deck.words.length !== WORDS_PER_DECK)
      errors.push(`${deck.title}: ${deck.words.length} words`);
    deck.words.forEach((word, i) => {
      const key = `${word.word}|${word.pos}`;
      if (keys.has(key)) errors.push(`${deck.title}: repeated ${key}`);
      keys.add(key);
      if (
        !word.ipaUs ||
        !word.ipaUk ||
        !word.meaningVi ||
        !word.exampleEn ||
        !word.exampleVi ||
        !word.collocation.phrase ||
        !word.collocation.meaningVi
      )
        errors.push(`${deck.title}: ${word.word} is incomplete`);
      const asArena = {
        id: 0,
        headword: word.word.toLowerCase(),
        displayWord: word.word,
        pos: word.pos,
        meaningVi: word.meaningVi,
        exampleEn: word.exampleEn,
        ipa: word.ipaUs,
        level: null,
      };
      if (!isDuelWord(asArena))
        errors.push(`${deck.title}: ${word.word} is not a duel word`);
      if (!blankedExample(asArena))
        errors.push(`${deck.title}: the example of ${word.word} lacks the word`);
      deck.words.slice(i + 1).forEach((other) => {
        if (meaningsClash(word.meaningVi, other.meaningVi))
          errors.push(
            `${deck.title}: ${word.word} and ${other.word} share a meaning`,
          );
      });
    });
  }
  return errors;
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  const i = process.argv.indexOf('--target');
  const target = i > 0 ? process.argv[i + 1] : undefined;
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url || !['dryrun', 'apply'].includes(mode ?? ''))
    throw new Error('usage: <dryrun|apply> --target <url|env:DATABASE_URL>');
  const write = mode === 'apply';
  if (write && process.env.VOCAB_ARENA_AUTHORIZED !== 'apply')
    throw new Error('REFUSED: VOCAB_ARENA_AUTHORIZED=apply not set');

  const errors = checkContent();
  if (errors.length) {
    console.error(errors.join('\n'));
    throw new Error(`CONTENT_ERRORS=${errors.length}`);
  }
  console.log(
    `CONTENT_OK decks=${ARENA_DECKS.length} words=${ARENA_DECKS.length * WORDS_PER_DECK}`,
  );

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const where = new URL(url);
    console.log(
      `TARGET=${where.hostname}:${where.port}${where.pathname} MODE=${mode}`,
    );
    const published = { publicationStatus: 'PUBLISHED' } as const;
    const before = await prisma.vocabTopic.count({ where: published });

    const entryFor = async (word: RawWord) => {
      const headword = word.word.trim().toLowerCase();
      const found = await prisma.dictionaryEntry.findUnique({
        where: { headword_pos: { headword, pos: word.pos } },
      });
      if (found) return { entry: found, reused: true };
      if (!write) return { entry: null, reused: false };
      const entry = await prisma.dictionaryEntry.create({
        data: {
          headword,
          displayWord: word.word,
          pos: word.pos,
          ipaUs: word.ipaUs,
          ipaUk: word.ipaUk,
          meaningVi: word.meaningVi,
          exampleEn: word.exampleEn,
          exampleVi: word.exampleVi,
          collocations: [word.collocation],
          source: 'CURATED',
          status: 'APPROVED',
        },
      });
      return { entry, reused: false };
    };

    let created = 0;
    let reused = 0;
    let decksAdded = 0;
    for (const deck of ARENA_DECKS) {
      const found = await prisma.vocabTopic.findFirst({
        where: { title: deck.title },
      });
      if (found) {
        console.log(`skip deck "${deck.title}" (#${found.id} exists)`);
        continue;
      }
      // Sequential, so a word shared by two decks is created once.
      const results: Awaited<ReturnType<typeof entryFor>>[] = [];
      for (const word of deck.words) results.push(await entryFor(word));
      const reusedHere = results.filter((r) => r.reused);
      reused += reusedHere.length;
      created += results.length - reusedHere.length;
      console.log(
        `add deck "${deck.title}" ${deck.level} ${deck.words.length} words` +
          (reusedHere.length
            ? ` (reuses ${reusedHere.map((r) => `${r.entry!.headword}#${r.entry!.id}`).join(', ')})`
            : ''),
      );
      decksAdded += 1;
      if (!write) continue;
      await prisma.vocabTopic.create({
        data: {
          title: deck.title,
          description: deck.description,
          level: deck.level,
          categoryName: deck.categoryName,
          totalWords: deck.words.length,
          publicationStatus: 'PUBLISHED',
          words: {
            create: results.map((r, index) => ({
              entryId: r.entry!.id,
              order: index,
            })),
          },
        },
      });
    }
    console.log(
      `DECKS_TO_ADD=${decksAdded} NEW_WORDS=${created} REUSED_WORDS=${reused}`,
    );
    console.log(
      `PUBLISHED_DECKS before=${before} after=${await prisma.vocabTopic.count({ where: published })}`,
    );
    if (!write) console.log('WRITES=0 (dryrun)');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
