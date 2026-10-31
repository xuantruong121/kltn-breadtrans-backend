/**
 * The level gate: a short auto-graded quiz that opens the next practice level
 * early (Listening and Reading; Speaking and Writing open through progress,
 * as an AI-graded gate costs too much). A gate is not an exam or a
 * certificate. No Prisma, no I/O.
 */
import { resolveReadingCorrectOption } from '../quiz/reading-content.validation';
import { GATE_COOLDOWN_HOURS, GATE_PASS_PERCENT } from './progression.logic';

export type GateSkill = 'LISTENING' | 'READING';

export const isGateSkill = (skill: string): skill is GateSkill =>
  skill === 'LISTENING' || skill === 'READING';

export type GateCandidate = { id: number; quizId: number; order: number };

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Up to `count` questions. Reading keeps a passage's questions together and
 * in order, taking quizzes until there are enough; Listening draws single
 * questions, each with its own clip.
 */
export function selectGateQuestions<T extends GateCandidate>(
  skill: GateSkill,
  candidates: T[],
  count: number,
  random: () => number = Math.random,
): T[] {
  if (skill === 'LISTENING')
    return shuffled(candidates, random).slice(0, count);
  const quizIds = shuffled(
    [...new Set(candidates.map((c) => c.quizId))],
    random,
  );
  return quizIds
    .flatMap((quizId) =>
      candidates
        .filter((c) => c.quizId === quizId)
        .sort((a, b) => a.order - b.order || a.id - b.id),
    )
    .slice(0, count);
}

/**
 * What a learner may see of a gate question, by allowlist: never the key,
 * explanations, transcripts or translations.
 */
export function gateQuestionView(
  skill: GateSkill,
  question: { id: number; quizId: number; content: unknown },
) {
  const content = (question.content ?? {}) as Record<string, unknown>;
  const text = typeof content.text === 'string' ? content.text : '';
  const options = Array.isArray(content.options)
    ? content.options.map(String)
    : [];
  return {
    id: question.id,
    quizId: question.quizId,
    text,
    options,
    ...(skill === 'READING' && typeof content.passage === 'string'
      ? { passage: content.passage }
      : {}),
    hasAudio: skill === 'LISTENING',
  };
}

function correctOption(skill: GateSkill, content: unknown): string | null {
  if (skill === 'READING') {
    const resolved = resolveReadingCorrectOption(content);
    return resolved.status === 'available' ? resolved.answer : null;
  }
  const c = (content ?? {}) as Record<string, unknown>;
  if (Array.isArray(c.options) && Number.isInteger(c.correctIndex))
    return String(c.options[c.correctIndex as number] ?? '') || null;
  return typeof c.correct === 'string' ? c.correct : null;
}

/** Correct answers among the served questions; a missing answer is wrong. */
export function gradeGate(
  skill: GateSkill,
  questions: Array<{ id: number; content: unknown }>,
  answers: Record<string, string>,
) {
  const correct = questions.filter((question) => {
    const key = correctOption(skill, question.content);
    return key !== null && answers[String(question.id)] === key;
  }).length;
  const total = questions.length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, score, passed: score >= GATE_PASS_PERCENT };
}

/** When a failed gate may be retried; null when it may be now. */
export function gateRetryAt(
  lastFailedAt: Date | null,
  now: Date = new Date(),
): Date | null {
  if (!lastFailedAt) return null;
  const retry = new Date(
    lastFailedAt.getTime() + GATE_COOLDOWN_HOURS * 60 * 60 * 1000,
  );
  return retry > now ? retry : null;
}
