/**
 * Learner statistics over submitted TOEIC Listening & Reading attempts.
 * Pure: the caller loads attempts, the exams' questions and the answers.
 *
 * Correctness is recomputed from the stored answers and answer keys, so the
 * per-Part table and the totals always agree. Scores are the existing
 * internal practice conversion (5 points per correct answer, 5-495 per
 * skill), never an ETS score.
 */

export type LrStatsAttempt = {
  id: number;
  examId: number;
  examTitle: string;
  mode: 'PRACTICE' | 'FULL_TEST';
  inAssessment: boolean;
  startedAt: Date | null;
  submittedAt: Date;
  listeningScore: number | null;
  readingScore: number | null;
  totalScore: number | null;
  /** Parts of a part practice; empty = the whole exam. */
  parts?: number[];
};
export type LrStatsQuestion = {
  id: number;
  examId: number;
  part: number;
  correctIndex: number;
  /** Question type label (see toeic-question-type.ts). */
  type: string;
};
export type LrStatsAnswer = {
  attemptId: number;
  questionId: number;
  selectedIndex: number | null;
};

export type Skill = 'LISTENING' | 'READING';
const skillOf = (part: number): Skill => (part <= 4 ? 'LISTENING' : 'READING');
const pct = (correct: number, total: number) =>
  total ? Math.round((correct / total) * 10000) / 100 : null;

/**
 * The learner's TOEIC goal, kept on Profile: `nextExamDate` (YYYY-MM-DD) and
 * `targetScore` (free text, read as TOEIC when it is "TOEIC <n>").
 */
export function parseToeicGoal(
  profile: { targetScore: string | null; nextExamDate: string | null } | null,
  today = new Date(),
) {
  const examDate =
    profile?.nextExamDate && /^\d{4}-\d{2}-\d{2}$/.test(profile.nextExamDate)
      ? profile.nextExamDate
      : null;
  const match = /^TOEIC\s*(\d{2,3})$/i.exec(profile?.targetScore?.trim() ?? '');
  const startOfToday = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return {
    examDate,
    daysUntilExam: examDate
      ? Math.max(
          0,
          Math.round((Date.parse(examDate) - startOfToday) / 86_400_000),
        )
      : null,
    targetScore: match ? Number(match[1]) : null,
  };
}

/** The window counts back from the learner's latest submission. */
export function windowStart(latest: Date | null, days: number | null) {
  if (!latest || !days) return null;
  return new Date(latest.getTime() - days * 24 * 3600 * 1000);
}

export function buildLrStats(input: {
  days: number | null;
  attempts: LrStatsAttempt[];
  questions: LrStatsQuestion[];
  answers: LrStatsAnswer[];
}) {
  const latest = input.attempts.reduce<Date | null>(
    (max, a) => (!max || a.submittedAt > max ? a.submittedAt : max),
    null,
  );
  const from = windowStart(latest, input.days);
  const attempts = input.attempts
    .filter((a) => !from || a.submittedAt >= from)
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  const ids = new Set(attempts.map((a) => a.id));
  const questionsByExam = new Map<number, LrStatsQuestion[]>();
  for (const q of input.questions)
    questionsByExam.set(q.examId, [
      ...(questionsByExam.get(q.examId) ?? []),
      q,
    ]);
  const answerOf = new Map<string, number | null>();
  for (const a of input.answers)
    if (ids.has(a.attemptId))
      answerOf.set(`${a.attemptId}:${a.questionId}`, a.selectedIndex);

  type PartTally = { correct: number; wrong: number; unanswered: number };
  const empty = (): PartTally => ({ correct: 0, wrong: 0, unanswered: 0 });
  const parts = new Map<number, PartTally>();
  const types = new Map<number, Map<string, PartTally>>();
  const rows = attempts.map((attempt) => {
    const tally = {
      LISTENING: { correct: 0, total: 0 },
      READING: { correct: 0, total: 0 },
    };
    const covered = (q: LrStatsQuestion) =>
      !attempt.parts?.length || attempt.parts.includes(q.part);
    for (const q of (questionsByExam.get(attempt.examId) ?? []).filter(
      covered,
    )) {
      const skill = skillOf(q.part);
      const chosen = answerOf.get(`${attempt.id}:${q.id}`);
      const part = parts.get(q.part) ?? empty();
      const partTypes = types.get(q.part) ?? new Map<string, PartTally>();
      const type = partTypes.get(q.type) ?? empty();
      tally[skill].total += 1;
      if (chosen === undefined || chosen === null) {
        part.unanswered += 1;
        type.unanswered += 1;
      } else if (chosen === q.correctIndex) {
        part.correct += 1;
        type.correct += 1;
        tally[skill].correct += 1;
      } else {
        part.wrong += 1;
        type.wrong += 1;
      }
      parts.set(q.part, part);
      partTypes.set(q.type, type);
      types.set(q.part, partTypes);
    }
    const durationSeconds =
      attempt.startedAt &&
      attempt.submittedAt.getTime() >= attempt.startedAt.getTime()
        ? Math.round(
            (attempt.submittedAt.getTime() - attempt.startedAt.getTime()) /
              1000,
          )
        : null;
    return { attempt, tally, durationSeconds };
  });

  const skill = (name: Skill) => {
    const withSkill = rows.filter((r) => r.tally[name].total > 0);
    const correct = withSkill.reduce((n, r) => n + r.tally[name].correct, 0);
    const total = withSkill.reduce((n, r) => n + r.tally[name].total, 0);
    const scores = withSkill
      .map((r) =>
        name === 'LISTENING'
          ? r.attempt.listeningScore
          : r.attempt.readingScore,
      )
      .filter((s): s is number => s !== null);
    const partNumbers = name === 'LISTENING' ? [1, 2, 3, 4] : [5, 6, 7];
    const timedSkill = withSkill.filter((r) => r.durationSeconds !== null);
    return {
      attempts: withSkill.length,
      correct,
      total,
      accuracy: pct(correct, total),
      averageScore: scores.length
        ? Math.round(scores.reduce((n, s) => n + s, 0) / scores.length)
        : null,
      bestScore: scores.length ? Math.max(...scores) : null,
      // Time of the whole test (sections are not timed separately).
      averageSeconds: timedSkill.length
        ? Math.round(
            timedSkill.reduce((n, r) => n + r.durationSeconds!, 0) /
              timedSkill.length,
          )
        : null,
      // Oldest first, for a left-to-right chart.
      trend: [...withSkill].reverse().map((r) => ({
        attemptId: r.attempt.id,
        submittedAt: r.attempt.submittedAt.toISOString(),
        accuracy: pct(r.tally[name].correct, r.tally[name].total),
      })),
      parts: partNumbers
        .filter((p) => parts.has(p))
        .map((p) => {
          const t = parts.get(p)!;
          return {
            part: p,
            ...t,
            accuracy: pct(t.correct, t.correct + t.wrong + t.unanswered),
            types: [...(types.get(p) ?? new Map<string, PartTally>()).entries()]
              .sort(([a], [b]) => a.localeCompare(b, 'vi'))
              .map(([type, tt]) => ({
                type,
                ...tt,
                accuracy: pct(
                  tt.correct,
                  tt.correct + tt.wrong + tt.unanswered,
                ),
              })),
          };
        }),
    };
  };

  const timed = rows.filter((r) => r.durationSeconds !== null);
  const practiceSeconds = timed.reduce((n, r) => n + r.durationSeconds!, 0);
  return {
    window: {
      days: input.days,
      from: from?.toISOString() ?? null,
      to: latest?.toISOString() ?? null,
    },
    overview: {
      attempts: rows.length,
      practiceSeconds,
      averageSeconds: timed.length
        ? Math.round(practiceSeconds / timed.length)
        : null,
    },
    skills: { LISTENING: skill('LISTENING'), READING: skill('READING') },
    attempts: rows.map(({ attempt, tally, durationSeconds }) => ({
      id: attempt.id,
      examId: attempt.examId,
      examTitle: attempt.examTitle,
      mode: attempt.mode,
      inAssessment: attempt.inAssessment,
      parts: attempt.parts ?? [],
      submittedAt: attempt.submittedAt.toISOString(),
      durationSeconds,
      listeningCorrect: tally.LISTENING.correct,
      listeningTotal: tally.LISTENING.total,
      readingCorrect: tally.READING.correct,
      readingTotal: tally.READING.total,
      totalScore: attempt.totalScore,
    })),
  };
}
