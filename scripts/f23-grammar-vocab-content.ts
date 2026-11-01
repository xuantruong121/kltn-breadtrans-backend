/**
 * F23A: adds the nine missing tense topics, tops every published grammar topic
 * up to ten questions, tags the eight existing decks with a level and adds
 * twelve new flashcard decks. Grammar goes through GrammarService, the same
 * rules as the Admin API. Safe to run twice: done work is skipped.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/f23-grammar-vocab-content.ts <dryrun|apply> --target <url|env:DATABASE_URL>
 * apply also needs F23_CONTENT_AUTHORIZED=apply.
 *
 * Audio is separate: scripts/generate-vocab-accent-audio.ts.
 */
import { createHash } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { questionProblems } from '../src/modules/grammar/grammar-question.logic';
import { GrammarService } from '../src/modules/grammar/grammar.service';
import {
  EXTRA_QUESTIONS,
  NEW_TOPICS,
  type RawQuestion,
} from './content/grammar-f23.data';
import {
  LEVELS_FOR_EXISTING,
  NEW_DECKS,
  type RawWord,
} from './content/vocab-f23.data';

const QUESTIONS_PER_TOPIC = 10;
const WORDS_PER_DECK = 12;

/** Stable shuffle: the key position depends on the question, not on run order. */
function prepare(raw: RawQuestion) {
  const rows = [
    { text: raw.a, note: null as string | null },
    ...raw.w.map((text, i) => ({ text, note: raw.n[i] })),
  ];
  const rank = (text: string) =>
    createHash('sha256').update(`${raw.q}|${text}`).digest('hex');
  rows.sort((x, y) => (rank(x.text) < rank(y.text) ? -1 : 1));
  return {
    question: raw.q,
    options: rows.map((r) => r.text),
    correctIndex: rows.findIndex((r) => r.text === raw.a),
    explanation: raw.e,
    optionExplanations: rows.map((r) => r.note),
  };
}

function checkContent() {
  const errors: string[] = [];
  const seen = new Set<string>();
  const check = (label: string, raw: RawQuestion) => {
    const prepared = prepare(raw);
    const problems = questionProblems(prepared);
    if (problems.length) errors.push(`${label}: ${problems.join('; ')}`);
    if (seen.has(raw.q)) errors.push(`${label}: duplicate "${raw.q}"`);
    seen.add(raw.q);
    if (!raw.e.trim() || raw.n.some((note) => !note.trim()))
      errors.push(`${label}: missing explanation`);
  };
  for (const topic of NEW_TOPICS) {
    if (topic.questions.length !== QUESTIONS_PER_TOPIC)
      errors.push(`${topic.title}: ${topic.questions.length} questions`);
    topic.questions.forEach((raw) => check(topic.title, raw));
  }
  for (const [title, list] of Object.entries(EXTRA_QUESTIONS)) {
    if (list.length !== 5) errors.push(`${title}: ${list.length} extra`);
    list.forEach((raw) => check(title, raw));
  }
  const words = new Set<string>();
  for (const deck of NEW_DECKS) {
    if (deck.words.length !== WORDS_PER_DECK)
      errors.push(`${deck.title}: ${deck.words.length} words`);
    for (const word of deck.words) {
      const key = `${word.word}|${word.pos}`;
      if (words.has(key)) errors.push(`${deck.title}: repeated ${key}`);
      words.add(key);
      if (!word.ipaUs || !word.ipaUk || !word.meaningVi || !word.exampleVi)
        errors.push(`${deck.title}: ${word.word} is incomplete`);
    }
  }
  const keys = [0, 0, 0, 0];
  [
    ...NEW_TOPICS.flatMap((t) => t.questions),
    ...Object.values(EXTRA_QUESTIONS).flat(),
  ].forEach((raw) => {
    keys[prepare(raw).correctIndex] += 1;
  });
  console.log(`answer keys A-D: ${keys.join(' / ')}`);
  console.log(`questions ${seen.size}, words ${words.size}`);
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
  if (mode === 'apply' && process.env.F23_CONTENT_AUTHORIZED !== 'apply')
    throw new Error('REFUSED: F23_CONTENT_AUTHORIZED=apply not set');

  const errors = checkContent();
  if (errors.length) {
    errors.forEach((e) => console.log(`CONTENT ERROR ${e}`));
    throw new Error(`STOP: ${errors.length} content errors`);
  }

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

    const existing = await prisma.grammarQuestion.findMany({
      select: { question: true },
    });
    const taken = new Set(existing.map((q) => q.question.trim()));

    for (const topic of NEW_TOPICS) {
      const found = await prisma.grammarTopic.findFirst({
        where: { title: topic.title },
      });
      if (found) {
        console.log(`skip topic "${topic.title}" (#${found.id} exists)`);
        continue;
      }
      console.log(
        `add topic "${topic.title}" ${topic.level} +${topic.questions.length}`,
      );
      if (!write) continue;
      const { questions, ...fields } = topic;
      const created = await service.createTopic(fields);
      await service.createQuestions(created.id, questions.map(prepare));
      await service.publishTopic(created.id);
    }

    for (const [title, list] of Object.entries(EXTRA_QUESTIONS)) {
      const topic = await prisma.grammarTopic.findFirst({
        where: { title, publicationStatus: 'PUBLISHED' },
        include: { _count: { select: { questions: true } } },
      });
      if (!topic) throw new Error(`STOP: no published topic "${title}"`);
      const fresh = list.filter((raw) => !taken.has(raw.q));
      if (!fresh.length) continue;
      if (topic._count.questions + fresh.length !== QUESTIONS_PER_TOPIC) {
        console.log(
          `skip "${title}" #${topic.id}: ${topic._count.questions} now, ${fresh.length} new`,
        );
        continue;
      }
      console.log(`topic "${title}" #${topic.id} +${fresh.length}`);
      if (write) await service.createQuestions(topic.id, fresh.map(prepare));
    }

    for (const row of LEVELS_FOR_EXISTING) {
      const deck = await prisma.vocabTopic.findUnique({
        where: { id: row.id },
      });
      if (!deck || deck.title !== row.title)
        throw new Error(`STOP: deck ${row.id} is not "${row.title}"`);
      if (deck.level === row.level) continue;
      console.log(`deck #${row.id} level ${deck.level ?? '-'} -> ${row.level}`);
      if (write)
        await prisma.vocabTopic.update({
          where: { id: row.id },
          data: { level: row.level },
        });
    }

    const entryFor = async (word: RawWord) => {
      const headword = word.word.trim().toLowerCase();
      const found = await prisma.dictionaryEntry.findUnique({
        where: { headword_pos: { headword, pos: word.pos } },
      });
      if (found || !write) return found;
      return prisma.dictionaryEntry.create({
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
    };

    let reused = 0;
    let created = 0;
    for (const deck of NEW_DECKS) {
      const found = await prisma.vocabTopic.findFirst({
        where: { title: deck.title },
      });
      if (found) {
        console.log(`skip deck "${deck.title}" (#${found.id} exists)`);
        continue;
      }
      const entries = await Promise.all(deck.words.map(entryFor));
      reused += deck.words.filter(
        (_, index) => write === false && entries[index],
      ).length;
      created += deck.words.filter(
        (_, index) => write === false && !entries[index],
      ).length;
      console.log(
        `add deck "${deck.title}" ${deck.level} ${deck.words.length} words`,
      );
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
            create: entries.map((entry, index) => ({
              entryId: entry!.id,
              order: index,
            })),
          },
        },
      });
    }
    if (!write)
      console.log(`words: ${created} new, ${reused} already in the dictionary`);

    const summary = await prisma.grammarTopic.findMany({
      where: { publicationStatus: 'PUBLISHED' },
      include: { _count: { select: { questions: true } } },
    });
    console.log(
      `published topics ${summary.length}, questions ${summary.reduce((n, t) => n + t._count.questions, 0)}`,
    );
    console.log(
      `decks ${await prisma.vocabTopic.count({ where: { publicationStatus: 'PUBLISHED' } })}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
