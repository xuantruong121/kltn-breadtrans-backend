import { BadRequestException } from '@nestjs/common';
import type { DictionaryEntry, Prisma, VocabWord } from '@prisma/client';

/**
 * Decks link to dictionary entries (F13). API responses keep the flat word
 * shape learners and the CMS already read, so the entry is folded in here.
 */
export const DECK_WORD_INCLUDE = { entry: true } as const;

export type DeckWordWithEntry = VocabWord & { entry: DictionaryEntry };

/** The lookup key: lower-case, trimmed, inner spaces collapsed. */
export const headwordOf = (word: string) =>
  word.trim().replace(/\s+/g, ' ').toLowerCase();

/** Flashcards teach words; a bare number ("10", "9:00") is not one. */
export function assertNotANumber(word?: string) {
  if (word && /^\d+([.,:]\d+)*$/.test(word.trim()))
    throw new BadRequestException('Số không dùng làm từ vựng flashcard.');
}

export const posOf = (pos?: string | null) =>
  (pos ?? '').trim().toLowerCase() || 'noun';

export function flattenDeckWord(row: DeckWordWithEntry) {
  const { entry, ...deckWord } = row;
  return {
    ...deckWord,
    word: entry.displayWord,
    pos: entry.pos,
    ipaUs: entry.ipaUs,
    ipaUk: entry.ipaUk,
    meaning: entry.meaningVi,
    audioUs: entry.audioUs,
    audioUk: entry.audioUk,
    exampleEn: entry.exampleEn,
    exampleVi: entry.exampleVi,
    collocations: entry.collocations,
    entryStatus: entry.status,
  };
}

/** The flat word fields a form or a seed sends, as entry data. */
export type WordFields = {
  word?: string;
  pos?: string;
  ipaUs?: string | null;
  ipaUk?: string | null;
  meaning?: string;
  definitionEn?: string | null;
  audioUs?: string | null;
  audioUk?: string | null;
  exampleEn?: string | null;
  exampleVi?: string | null;
  collocations?: unknown;
};

const blankToNull = (value?: string | null) =>
  value === undefined ? undefined : value?.trim() ? value.trim() : null;

export function entryDataFromWord(
  fields: WordFields,
): Omit<Prisma.DictionaryEntryUpdateInput, 'deckWords'> {
  return {
    ...(fields.word !== undefined && {
      headword: headwordOf(fields.word),
      displayWord: fields.word.trim(),
    }),
    ...(fields.pos !== undefined && { pos: posOf(fields.pos) }),
    ...(fields.meaning !== undefined && { meaningVi: fields.meaning.trim() }),
    ...(fields.definitionEn !== undefined && {
      definitionEn: blankToNull(fields.definitionEn),
    }),
    ...(fields.ipaUs !== undefined && { ipaUs: blankToNull(fields.ipaUs) }),
    ...(fields.ipaUk !== undefined && { ipaUk: blankToNull(fields.ipaUk) }),
    ...(fields.audioUs !== undefined && {
      audioUs: blankToNull(fields.audioUs),
    }),
    ...(fields.audioUk !== undefined && {
      audioUk: blankToNull(fields.audioUk),
    }),
    ...(fields.exampleEn !== undefined && {
      exampleEn: blankToNull(fields.exampleEn),
    }),
    ...(fields.exampleVi !== undefined && {
      exampleVi: blankToNull(fields.exampleVi),
    }),
    ...(fields.collocations !== undefined && {
      collocations: fields.collocations ?? undefined,
    }),
  };
}
