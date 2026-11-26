import { levelRank, type ArenaWord } from './arena-questions.logic';
import type { HardWordRow } from './hard-words.logic';

/**
 * The words both Arena games draw from (the 1v1 duel and Pháo Bánh Mì):
 * reviewed curated dictionary entries, with the level of the easiest
 * published deck holding each. Only the Prisma calls live here; choosing and
 * shaping questions stays in the pure logic files.
 */
type EntryRow = {
  id: number;
  headword: string;
  displayWord: string;
  pos: string;
  meaningVi: string;
  exampleEn: string | null;
  ipaUs: string | null;
  ipaUk: string | null;
  deckWords?: { topic: { id: number; level: string | null } }[];
};

type DictionaryReader = {
  dictionaryEntry: { findMany: (args: any) => Promise<EntryRow[]> };
};

const REVIEWED = { status: 'APPROVED', source: 'CURATED' } as const;

export function toArenaWord(entry: EntryRow): ArenaWord {
  const ranks = (entry.deckWords ?? [])
    .map((d) => levelRank(d.topic.level))
    .filter((r): r is number => r !== null);
  return {
    id: entry.id,
    headword: entry.headword,
    displayWord: entry.displayWord,
    pos: entry.pos,
    meaningVi: entry.meaningVi,
    exampleEn: entry.exampleEn,
    ipa: entry.ipaUs || entry.ipaUk,
    level: ranks.length ? Math.min(...ranks) : null,
    topics: (entry.deckWords ?? []).map((d) => d.topic.id),
  };
}

/** Words of the published vocabulary decks. */
export async function loadDeckWords(
  prisma: DictionaryReader,
): Promise<ArenaWord[]> {
  const rows = await prisma.dictionaryEntry.findMany({
    where: {
      ...REVIEWED,
      deckWords: { some: { topic: { publicationStatus: 'PUBLISHED' } } },
    },
    include: {
      deckWords: {
        where: { topic: { publicationStatus: 'PUBLISHED' } },
        select: { topic: { select: { id: true, level: true } } },
      },
    },
  });
  return rows.map(toArenaWord);
}

/** Every reviewed word, for when the decks cannot fill a game. */
export async function loadAllReviewedWords(
  prisma: DictionaryReader,
): Promise<ArenaWord[]> {
  const rows = await prisma.dictionaryEntry.findMany({ where: REVIEWED });
  return rows.map(toArenaWord);
}

type ProgressRow = {
  lapses: number;
  easeFactor: number;
  nextReviewAt: Date | null;
  word: { entryId: number | null } | null;
};

// The rows are shaped by the `select` below; Prisma's own return type is
// generic over the arguments, so the reader is kept loose here.
type ProgressReader = {
  userVocabWordProgress: { findMany: (args: any) => Promise<unknown[]> };
};

/**
 * The learner's hard flashcard words (a lapse or a lowered ease), as
 * dictionary entries: the single-player games ask some of them again
 * (thesis supervisor 2026-11-26). Read only.
 */
export async function loadHardWords(
  prisma: ProgressReader,
  userId: number,
): Promise<HardWordRow[]> {
  const rows = (await prisma.userVocabWordProgress.findMany({
    where: {
      userId,
      OR: [{ lapses: { gt: 0 } }, { easeFactor: { lt: 2.5 } }],
    },
    select: {
      lapses: true,
      easeFactor: true,
      nextReviewAt: true,
      word: { select: { entryId: true } },
    },
    orderBy: { nextReviewAt: 'asc' },
    take: 200,
  })) as ProgressRow[];
  return rows
    .filter((r) => typeof r.word?.entryId === 'number')
    .map((r) => ({
      entryId: r.word!.entryId!,
      lapses: r.lapses,
      easeFactor: r.easeFactor,
      nextReviewAt: r.nextReviewAt,
    }));
}
