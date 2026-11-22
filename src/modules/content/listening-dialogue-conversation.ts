/**
 * A "Hội thoại" quiz has one conversation, copied into every multiple-choice
 * question: the shape every published dialogue quiz has, and the one the
 * shared recording is built from. Until a question exists, the editor keeps
 * the conversation on the quiz as bilingualContent.draftTranscript. Pure:
 * no I/O.
 */
import { normalizeDialogueSegments } from '../quiz/listening-dialogue.contract';
import { isTranscriptHolder } from './skill-cms-list';

/** The editor's conversation on a quiz that has no question to carry it yet. */
export const DRAFT_TRANSCRIPT_KEY = 'draftTranscript';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const hasDraftTranscript = (metadata: unknown) =>
  DRAFT_TRANSCRIPT_KEY in asRecord(metadata);

/**
 * The quiz metadata without the draft conversation. A learner's quiz payload
 * carries bilingualContent, and the transcript stays behind the reveal, so a
 * published quiz never keeps it.
 */
export function withoutDraftTranscript<T>(metadata: T): T {
  if (!hasDraftTranscript(metadata)) return metadata;
  const copy = { ...asRecord(metadata) };
  delete copy[DRAFT_TRANSCRIPT_KEY];
  return copy as T;
}

type QuestionRow = { type: string; content: unknown };

/**
 * What a "Hội thoại" quiz lacks besides each question's own checks: one
 * multiple-choice question, and a conversation of at least 2 turns by 2
 * speakers. A legacy transcript holder is checked as its own row instead.
 */
export function dialogueQuizIssues(
  mode: unknown,
  questions: QuestionRow[],
): string[] {
  if (mode !== 'DIALOGUE') return [];
  const issues: string[] = [];
  const answered = questions.filter(
    (question) => !isTranscriptHolder(question),
  );
  if (
    answered.length &&
    !answered.some((question) => question.type === 'MULTIPLE_CHOICE')
  )
    issues.push('Cần ít nhất một câu trắc nghiệm');
  if (!questions.some(isTranscriptHolder)) {
    const source = questions.find((question) => {
      const segments = asRecord(question.content).transcriptSegments;
      return Array.isArray(segments) && segments.length > 0;
    });
    const turns = normalizeDialogueSegments(
      asRecord(source?.content).transcriptSegments,
    );
    const speakers = new Set(
      turns.map((turn) => turn.speakerId ?? turn.speaker),
    );
    if (turns.length < 2 || speakers.size < 2)
      issues.push('Lời thoại: cần ít nhất 2 lượt lời của 2 người nói');
  }
  return issues;
}
