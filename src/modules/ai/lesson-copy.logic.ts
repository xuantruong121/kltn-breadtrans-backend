/**
 * Title and description of a Listening or Reading lesson drafted by the AI
 * in the CMS (owner 2026-11-24: "Daily Communication Practice" replaced the
 * Vietnamese title typed by the admin, and its description was English,
 * while every published lesson has a Vietnamese description). Only the
 * learning content (audio text, passage, questions, options) is English;
 * Speaking (SPEAKING_SET_COPY_RULE), Writing and dictation drafts already
 * write their title and description in Vietnamese.
 *
 * Pure: no I/O.
 */
import type { PracticeLevel } from '@prisma/client';

import { legacyPracticeLevel } from '../subscription/practice-level';

export const LESSON_COPY_RULE =
  'Write title and description in Vietnamese, for Vietnamese learners; keep the words of the topic when it is already Vietnamese. ' +
  'Title: short, with no CEFR code, like "Giao tiếp hằng ngày" or "Mua sắm ở siêu thị". ' +
  'Description: one Vietnamese sentence under 160 characters saying what the learner practises, like "Nghe hội thoại giữa khách hàng và nhân viên siêu thị về việc mua hàng."';

/**
 * What each practice level (owner 2026-11-27: Mất gốc, Cơ bản, Trung cấp,
 * Nâng cao) asks of the English a learner meets. Written as plain language
 * targets for the AI; the levels are BreadTrans practice levels, and no level
 * name or code reaches the learner through these lines.
 */
const LEVEL_LANGUAGE: Record<PracticeLevel, string> = {
  STARTER:
    'a learner starting from zero: the most common words, present simple, sentences of 4 to 8 words, slow and clear',
  BASIC:
    'a learner with the basics: common everyday words, simple past and future, sentences of 6 to 12 words',
  INTERMEDIATE:
    'a learner who handles daily and work situations: everyday, work and travel words with some phrasal verbs and fixed expressions, varied tenses, linked sentences of 8 to 20 words, natural pace',
  ADVANCED:
    'a confident learner: precise and idiomatic vocabulary, complex sentences, implied meaning and opinions, natural fast pace',
};

/** Turns of a "Hội thoại" dialogue for each level: longer talks as the level rises. */
const DIALOGUE_TURNS: Record<PracticeLevel, string> = {
  STARTER: '6 to 8',
  BASIC: '6 to 10',
  INTERMEDIATE: '8 to 14',
  ADVANCED: '10 to 14',
};

/** The practice level of a request; an old CEFR or BEGINNER value is read too. */
function practiceLevelOf(level: string | undefined): PracticeLevel | null {
  return legacyPracticeLevel(level);
}

/**
 * The rule every Listening full draft carries (owner 2026-11-25: "Soạn cả bài
 * bằng AI" sent the title and level only as reference data, with nothing
 * telling the AI to write about that topic at that level; dictation, reading
 * and the transcript helper already named a level). The topic sets
 * the situation, the level sets the language and how hard the questions are,
 * and a dialogue gets a length that fits the level.
 */
export function listeningDraftRule(
  level: string | undefined,
  mode: string,
): string {
  const lv = practiceLevelOf(level) ?? 'BASIC';
  const parts = [
    'Topic: everything in the lesson is about the topic in the reference data (the lesson title): the situation, the speakers and every question follow it. A Vietnamese topic gives the situation; write new English for it, never a translation of its words.',
    `Level: write all English for ${LEVEL_LANGUAGE[lv]}. The questions and every option use the same level, and the right answer needs only what the learner hears.`,
  ];
  if (mode === 'DIALOGUE')
    parts.push(
      `Dialogue: ${DIALOGUE_TURNS[lv]} turns between two speakers, each turn one or two sentences.`,
    );
  return parts.join(' ');
}

/**
 * The admin's own description sent with a lesson draft request (owner
 * 2026-11-25: "gửi luôn mô tả cho AI"): one line, at most 300 characters;
 * none when the box was empty, and the draft then follows the title alone.
 */
export function draftBrief(
  brief: string | null | undefined,
): string | undefined {
  const text = (brief ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return text || undefined;
}

/**
 * Added to a draft prompt only when a brief was sent: the reference data then
 * carries it as "situation", and the lesson plays that situation out.
 */
export function situationRule(brief: string | undefined): string {
  return brief
    ? "Situation: the reference data also gives a situation, the admin's own description of this lesson. The lesson plays out exactly that situation within the topic: the same people, place and purpose. "
    : '';
}

/**
 * What a CMS level asks of the English, for every content area (one scale
 * since 2026-11-27). Undefined for no level or an unknown one.
 */
export function levelLanguage(level: string | undefined): string | undefined {
  const lv = practiceLevelOf(level);
  return lv ? LEVEL_LANGUAGE[lv] : undefined;
}

/** The CMS areas whose full draft follows the title, the level and the brief. */
export type DraftSubject =
  'READING' | 'WRITING' | 'SPEAKING' | 'GRAMMAR' | 'VOCAB';

const NO_TRANSLATION =
  'A Vietnamese topic gives the subject; write new English for it, never a translation of its words.';

const DRAFT_TOPIC: Record<DraftSubject, string> = {
  READING: `Topic: the passage and every question are about the topic in the reference data (the lesson title). ${NO_TRANSLATION}`,
  WRITING: `Topic: every task is about the topic in the reference data (the exercise title): its situations, people and purpose follow it. ${NO_TRANSLATION}`,
  SPEAKING: `Topic: every exercise is about the topic in the reference data (the practice set title): its situations, roles and words follow it. ${NO_TRANSLATION}`,
  GRAMMAR:
    'Topic: topicTitle in the reference data names the grammar point. The theory, the key formula and every question practise exactly that structure, never another one.',
  VOCAB:
    'Topic: every word belongs to the topic in the reference data (the deck title): a word a learner meets or needs in that situation.',
};

const DRAFT_LEVEL: Record<DraftSubject, (language: string) => string> = {
  READING: (language) =>
    `Level: write the passage, the questions and every option for ${language}. The right answer needs only what the passage says.`,
  WRITING: (language) =>
    `Level: every task suits ${language}. The English a good answer needs, any Vietnamese sentence to translate and the word range all fit that level.`,
  SPEAKING: (language) => `Level: write every targetText for ${language}.`,
  GRAMMAR: (language) =>
    `Level: explain the structure for ${language}, and write every English example, question and option at that level.`,
  VOCAB: (language) =>
    `Level: choose the words that fit ${language}; write each exampleEn at that level.`,
};

/**
 * How a vocabulary draft is written (owner 2026-11-25: a deck could not be
 * published while a word had no phonetics, and the AI was never asked for
 * them; meanings came back in English).
 */
export const VOCAB_WORD_RULE =
  'Each word: "meaning" is its Vietnamese meaning with full diacritics, short like a dictionary entry ("chương trình họp"); "pos" is the part of speech in lowercase English (noun, verb, adjective, adverb, phrase); "ipaUs" is the American IPA between slashes, like "/əˈdʒendə/"; "exampleEn" is one original English sentence using the word; "exampleVi" is its Vietnamese translation.';

/**
 * The rule every Reading, Writing, Speaking, Grammar and Vocabulary full
 * draft carries (owner 2026-11-25: as for Listening, these prompts only put
 * the title and the level in the reference data, with nothing telling the AI
 * to follow them). The topic sets what the draft is about, the level sets
 * its language; an unknown level adds no level line.
 */
export function draftRule(
  subject: DraftSubject,
  level: string | undefined,
): string {
  const language = levelLanguage(level);
  const parts = [DRAFT_TOPIC[subject]];
  if (language) parts.push(DRAFT_LEVEL[subject](language));
  if (subject === 'VOCAB') parts.push(VOCAB_WORD_RULE);
  return parts.join(' ');
}

/**
 * The admin's own description for areas where "situation" does not fit: a
 * Vocabulary deck picks its words for it, a Grammar topic follows the
 * admin's note or key formula. Empty when nothing was sent.
 */
export function briefRule(
  subject: 'VOCAB' | 'GRAMMAR',
  brief: string | undefined,
): string {
  if (!brief) return '';
  return subject === 'VOCAB'
    ? "Situation: the reference data also gives a situation, the admin's own description of this deck. Choose the words a learner needs in exactly that situation, within the topic. "
    : "Focus: the reference data also gives focus, the admin's own note or key formula for this grammar point. The theory, the key formula and the questions follow it. ";
}
