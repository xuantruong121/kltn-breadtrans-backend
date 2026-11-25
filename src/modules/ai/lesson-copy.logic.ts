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
export const LESSON_COPY_RULE =
  'Write title and description in Vietnamese, for Vietnamese learners; keep the words of the topic when it is already Vietnamese. ' +
  'Title: short, with no CEFR code, like "Giao tiếp hằng ngày" or "Mua sắm ở siêu thị". ' +
  'Description: one Vietnamese sentence under 160 characters saying what the learner practises, like "Nghe hội thoại giữa khách hàng và nhân viên siêu thị về việc mua hàng."';

/** What each CMS level asks of the English a learner hears. */
const LEVEL_LANGUAGE: Record<string, string> = {
  A1: 'very common words, present simple, sentences of 4 to 8 words, slow and clear',
  A2: 'common everyday words, simple past and future, sentences of 6 to 12 words',
  B1: 'everyday and some work or travel words, linked sentences of 8 to 16 words',
  B2: 'a wider vocabulary with some phrasal verbs and fixed expressions, varied tenses, sentences of 10 to 20 words, natural pace',
  C1: 'precise and idiomatic vocabulary, complex sentences, implied meaning and opinions, natural fast pace',
  C2: 'idiomatic, nuanced language with implied meaning, natural fast pace',
};

/** Turns of a "Hội thoại" dialogue for each level: longer talks as the level rises. */
const DIALOGUE_TURNS: Record<string, string> = {
  A1: '6 to 8',
  A2: '6 to 10',
  B1: '8 to 12',
  B2: '10 to 14',
  C1: '10 to 14',
  C2: '10 to 14',
};

/**
 * The rule every Listening full draft carries (owner 2026-11-25: "Soạn cả bài
 * bằng AI" sent the title and level only as reference data, with nothing
 * telling the AI to write about that topic at that level; dictation, reading
 * and the transcript helper already said "at CEFR level ..."). The topic sets
 * the situation, the level sets the language and how hard the questions are,
 * and a dialogue gets a length that fits the level.
 */
export function listeningDraftRule(
  level: string | undefined,
  mode: string,
): string {
  const lv = level && LEVEL_LANGUAGE[level] ? level : 'A2';
  const parts = [
    'Topic: everything in the lesson is about the topic in the reference data (the lesson title): the situation, the speakers and every question follow it. A Vietnamese topic gives the situation; write new English for it, never a translation of its words.',
    `Level: write all English for a learner at CEFR level ${lv}: ${LEVEL_LANGUAGE[lv]}. The questions and every option use the same level, and the right answer needs only what the learner hears.`,
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

/** Grammar and Vocabulary use three broad levels instead of CEFR codes. */
const BROAD_LEVEL_LANGUAGE: Record<string, string> = {
  BEGINNER:
    'very common everyday words, present and simple past, short sentences of 4 to 12 words',
  INTERMEDIATE:
    'everyday, work and travel words, varied tenses, linked sentences of 8 to 18 words',
  ADVANCED:
    'a wide and precise vocabulary with fixed expressions, complex sentences and implied meaning',
};

/**
 * What a CMS level asks of the English: a CEFR code ("B1"), a Speaking range
 * ("B1-B2", from the lower level up to the higher one), or one of the three
 * Grammar and Vocabulary levels. Undefined for no level or an unknown one.
 */
export function levelLanguage(level: string | undefined): string | undefined {
  if (!level) return undefined;
  if (LEVEL_LANGUAGE[level])
    return `CEFR level ${level}: ${LEVEL_LANGUAGE[level]}`;
  const range = /^([ABC][12])-([ABC][12])$/.exec(level);
  if (range && LEVEL_LANGUAGE[range[1]] && LEVEL_LANGUAGE[range[2]])
    return `CEFR level ${range[1]} to ${range[2]}: from ${LEVEL_LANGUAGE[range[1]]}, up to ${LEVEL_LANGUAGE[range[2]]}`;
  if (BROAD_LEVEL_LANGUAGE[level])
    return `${level.toLowerCase()} level: ${BROAD_LEVEL_LANGUAGE[level]}`;
  return undefined;
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
    `Level: write the passage, the questions and every option for a learner at ${language}. The right answer needs only what the passage says.`,
  WRITING: (language) =>
    `Level: every task suits a learner at ${language}. The English a good answer needs, any Vietnamese sentence to translate and the word range all fit that level.`,
  SPEAKING: (language) =>
    `Level: write every targetText for a learner at ${language}.`,
  GRAMMAR: (language) =>
    `Level: explain the structure for a learner at ${language}, and write every English example, question and option at that level.`,
  VOCAB: (language) =>
    `Level: choose the words a learner at ${language} needs next, and write each exampleEn at that level.`,
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
