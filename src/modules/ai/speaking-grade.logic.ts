import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Speaking Part 3-5 grading has no fallback score. When the grader fails,
 * the learner gets GRADING_FAILED with score null and can submit again.
 */
export type SpeakingGradeFailureCode =
  | 'GRADER_NOT_CONFIGURED'
  | 'GRADER_UNAVAILABLE'
  | 'GRADER_OUTPUT_INVALID'
  | 'SCORE_OUT_OF_RANGE';

/** Part 3-4 score 0-3 and Part 5 scores 0-5; the endpoint does not say which part it grades. */
export const SPEAKING_P3_TO_5_MAX_SCORE = 5;

export function speakingGradeFailure(
  code: SpeakingGradeFailureCode,
  message: string,
): ServiceUnavailableException {
  return new ServiceUnavailableException({
    status: 'GRADING_FAILED',
    score: null,
    code,
    message,
  });
}

export class SpeakingGradeOutputError extends Error {
  constructor(
    readonly code: 'GRADER_OUTPUT_INVALID' | 'SCORE_OUT_OF_RANGE',
    message: string,
  ) {
    super(message);
  }
}

/** Parses the grader's reply; throws SpeakingGradeOutputError instead of guessing. */
export function parseSpeakingPart3To5Grade(raw: string): {
  score: number;
  feedback: string;
  suggestions: string[];
} {
  let text = raw.trim();
  if (text.startsWith('```json'))
    text = text.substring(7, text.length - 3).trim();
  else if (text.startsWith('```'))
    text = text.substring(3, text.length - 3).trim();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SpeakingGradeOutputError(
      'GRADER_OUTPUT_INVALID',
      'Grader reply is not JSON',
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new SpeakingGradeOutputError(
      'GRADER_OUTPUT_INVALID',
      'Grader reply is not an object',
    );
  }
  const { score, feedback, suggestions } = parsed;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    throw new SpeakingGradeOutputError(
      'GRADER_OUTPUT_INVALID',
      'Grader reply has no numeric score',
    );
  }
  if (
    !Number.isInteger(score) ||
    score < 0 ||
    score > SPEAKING_P3_TO_5_MAX_SCORE
  ) {
    throw new SpeakingGradeOutputError(
      'SCORE_OUT_OF_RANGE',
      `Score ${score} is outside 0-${SPEAKING_P3_TO_5_MAX_SCORE}`,
    );
  }
  if (typeof feedback !== 'string' || !feedback.trim()) {
    throw new SpeakingGradeOutputError(
      'GRADER_OUTPUT_INVALID',
      'Grader reply has no feedback',
    );
  }
  return {
    score,
    feedback,
    suggestions: Array.isArray(suggestions)
      ? suggestions.filter((s): s is string => typeof s === 'string')
      : [],
  };
}
