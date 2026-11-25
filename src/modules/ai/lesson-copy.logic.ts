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
