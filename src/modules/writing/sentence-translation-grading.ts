/**
 * AI fallback for "Dịch câu": only an answer that matches none of the accepted
 * translations reaches it. Pure: builds the request and checks the reply.
 */
import { hasVietnameseDiacritics } from '../diagnostic/diagnostic-productive';
import {
  normalizeEnglishSentence,
  type SentenceTranslationTask,
} from './sentence-translation.logic';

export const TRANSLATION_VERDICTS = ['CORRECT', 'MINOR', 'WRONG'] as const;
export type TranslationVerdict = (typeof TRANSLATION_VERDICTS)[number];

export const TRANSLATION_ERROR_TAGS = [
  'MEANING',
  'ARTICLE',
  'BE_VERB',
  'PLURAL',
  'TENSE',
  'WORD_ORDER',
  'WORD_CHOICE',
  'SPELLING',
  'MISSING_WORD',
  'EXTRA_WORD',
] as const;

export const TRANSLATION_SCORE: Record<TranslationVerdict, number> = {
  CORRECT: 2,
  MINOR: 1,
  WRONG: 0,
};

export type TranslationGrade = {
  verdict: TranslationVerdict;
  correctedSentence: string;
  explanation: string;
  errorTags: string[];
};

export function buildTranslationGradeRequest(
  task: SentenceTranslationTask,
  answer: string,
) {
  const systemInstruction = [
    'You grade one English translation written by a Vietnamese beginner (roughly A1-A2) of one Vietnamese sentence.',
    'The accepted translations are correct references, not the only correct answers: a different translation that keeps the full meaning and is grammatical English is CORRECT.',
    'Verdicts: CORRECT = same meaning and grammatical (natural word choice differences are fine); MINOR = the meaning is right but there is one small error (a missing or wrong article, a missing plural -s, one wrong verb form, one misspelt word); WRONG = the meaning changes or is incomplete, or there are several errors, or "be" is missing, or the tense is wrong.',
    'Check what Vietnamese learners often get wrong: articles (a/an/the), the verb "be", plural -s, third-person -s, tense (đã = past, sẽ = future, đang = continuous), word order, prepositions.',
    "correctedSentence: the learner's sentence with the fewest changes that make it correct; when the verdict is CORRECT, return the learner's sentence unchanged.",
    'explanation: one or two short sentences in Vietnamese with full diacritics (never unaccented), naming the exact words that are wrong and why; when CORRECT, say briefly why it is acceptable.',
    'errorTags: the error kinds present, from the allowed list; empty when CORRECT.',
  ].join('\n');
  const prompt = JSON.stringify({
    vietnamese: task.prompt,
    acceptedTranslations: task.acceptedAnswers,
    learnerAnswer: answer,
  });
  const responseSchema = {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: [...TRANSLATION_VERDICTS] },
      correctedSentence: { type: 'string' },
      explanation: { type: 'string' },
      errorTags: {
        type: 'array',
        items: { type: 'string', enum: [...TRANSLATION_ERROR_TAGS] },
      },
    },
    required: ['verdict', 'correctedSentence', 'explanation', 'errorTags'],
  };
  return { systemInstruction, prompt, responseSchema };
}

/** Accepts a reply only when every field is usable; never trusts it blindly. */
export function validateTranslationGrade(
  raw: unknown,
  answer: string,
): { ok: true; value: TranslationGrade } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object')
    return { ok: false, reason: 'NOT_OBJECT' };
  const r = raw as Record<string, unknown>;
  if (!TRANSLATION_VERDICTS.includes(r.verdict as TranslationVerdict))
    return { ok: false, reason: 'BAD_VERDICT' };
  const explanation =
    typeof r.explanation === 'string' ? r.explanation.trim() : '';
  if (explanation.length < 10 || !hasVietnameseDiacritics(explanation))
    return { ok: false, reason: 'EXPLANATION_NOT_VIETNAMESE' };
  const corrected =
    typeof r.correctedSentence === 'string' ? r.correctedSentence.trim() : '';
  if (!corrected || normalizeEnglishSentence(corrected).length === 0)
    return { ok: false, reason: 'NO_CORRECTION' };
  const tags = Array.isArray(r.errorTags)
    ? r.errorTags.filter(
        (t): t is string =>
          typeof t === 'string' &&
          (TRANSLATION_ERROR_TAGS as readonly string[]).includes(t),
      )
    : [];
  const verdict = r.verdict as TranslationVerdict;
  return {
    ok: true,
    value: {
      verdict,
      // A CORRECT answer keeps the learner's own wording.
      correctedSentence: verdict === 'CORRECT' ? answer.trim() : corrected,
      explanation,
      errorTags: verdict === 'CORRECT' ? [] : [...new Set(tags)],
    },
  };
}
