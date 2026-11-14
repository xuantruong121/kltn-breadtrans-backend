/**
 * The stored and returned shape of one checked translation. Pure.
 */
import {
  diffWords,
  SENTENCE_TRANSLATION_MAX_SCORE,
  type DiffWord,
  type SentenceTranslationTask,
  type TranslationHint,
} from './sentence-translation.logic';
import {
  TRANSLATION_SCORE,
  type TranslationGrade,
  type TranslationVerdict,
} from './sentence-translation-grading';

export type TranslationCheckVerdict = TranslationVerdict | 'UNMATCHED';

export type TranslationCheck = {
  verdict: TranslationCheckVerdict;
  /** MATCH: an accepted answer; AI: the AI grader; NO_AI: no grading left today. */
  source: 'MATCH' | 'AI' | 'NO_AI';
  score: number;
  maxScore: number;
  answer: string;
  typo: { typed: string; expected: string } | null;
  /** The accepted translation closest to the answer. */
  closest: string;
  /** Up to two more accepted translations. */
  otherAnswers: string[];
  /** Word marks of the answer against `closest`; null for an exact match. */
  diff: { answer: DiffWord[]; reference: DiffWord[] } | null;
  correctedSentence: string | null;
  explanation: string | null;
  errorTags: string[];
  grammarTip: string;
  hints: TranslationHint[];
  quotaExhausted: boolean;
};

export function translationVerdictLabel(v: TranslationCheckVerdict): string {
  switch (v) {
    case 'CORRECT':
      return 'Đúng';
    case 'MINOR':
      return 'Gần đúng';
    case 'WRONG':
      return 'Chưa đúng';
    default:
      return 'Chưa khớp đáp án mẫu';
  }
}

export function translationResult(
  task: SentenceTranslationTask,
  answer: string,
  input: {
    verdict: TranslationCheckVerdict;
    source: TranslationCheck['source'];
    closest: string;
    typo?: TranslationCheck['typo'];
    grade?: TranslationGrade;
    quotaExhausted?: boolean;
  },
): TranslationCheck {
  const exact = input.source === 'MATCH' && !input.typo;
  return {
    verdict: input.verdict,
    source: input.source,
    score: input.verdict === 'UNMATCHED' ? 0 : TRANSLATION_SCORE[input.verdict],
    maxScore: SENTENCE_TRANSLATION_MAX_SCORE,
    answer,
    typo: input.typo ?? null,
    closest: input.closest,
    otherAnswers: task.acceptedAnswers
      .filter((a) => a !== input.closest)
      .slice(0, 2),
    diff: exact ? null : diffWords(answer, input.closest),
    correctedSentence: input.grade?.correctedSentence ?? null,
    explanation:
      input.grade?.explanation ??
      (input.typo
        ? `Đúng, chỉ sai chính tả: "${input.typo.typed}" phải viết là "${input.typo.expected}".`
        : input.quotaExhausted
          ? 'Hôm nay đã hết lượt AI chấm nên câu này chỉ được so với đáp án mẫu. Hãy so câu của bạn với đáp án bên dưới.'
          : null),
    errorTags: input.grade?.errorTags ?? [],
    grammarTip: task.grammarTip,
    hints: task.hints,
    quotaExhausted: Boolean(input.quotaExhausted),
  };
}
