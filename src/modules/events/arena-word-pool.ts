import { levelRank, type ArenaWord } from './arena-questions.logic';

/**
 * The words both Arena games draw from (the 1v1 duel and Bắn chữ rơi):
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
