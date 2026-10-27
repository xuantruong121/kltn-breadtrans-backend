/**
 * Read-only task review of a TOEIC assessment attempt (S&W or 4 Skills).
 * Pure: maps already-loaded rows to one entry per authored task, in task
 * order, with the stored grade of the learner's submission. Nothing here
 * grades, regrades or calls a provider; an ungraded task stays ungraded.
 *
 * Task status:
 *  - NOT_SUBMITTED  no submission for the task in this attempt
 *  - PENDING        submitted, grading not finished (queued or running)
 *  - FAILED         grading failed
 *  - NO_SPEECH      graded, but no speech was recognized (Speaking only)
 *  - GRADED         a stored practice score exists
 */
export type AssessmentTaskStatus =
  'NOT_SUBMITTED' | 'PENDING' | 'FAILED' | 'NO_SPEECH' | 'GRADED';

type SpeakingRow = {
  id: number;
  exerciseId: number;
  status: string;
  overallScore: number | null;
  transcript: string | null;
  aiFeedback: unknown;
  audioKey: string | null;
  audioUrl: string | null;
  submittedAt: Date;
};

type WritingRow = {
  id: number;
  quizId: number;
  score: number | null;
  aiFeedback: string | null;
  submittedAt: Date;
};

function latest<T extends { id: number }>(rows: T[]): T | null {
  return rows.reduce<T | null>((a, b) => (a && a.id > b.id ? a : b), null);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function speakingTaskStatus(
  row: Pick<SpeakingRow, 'status' | 'overallScore'> | null,
): AssessmentTaskStatus {
  if (!row) return 'NOT_SUBMITTED';
  if (row.status === 'FAILED') return 'FAILED';
  if (row.status !== 'COMPLETED') return 'PENDING';
  return row.overallScore === null ? 'NO_SPEECH' : 'GRADED';
}

export function reviewSpeakingTasks(
  exercises: Array<{
    id: number;
    title: string;
    taskType: string | null;
    targetText: string;
    imageUrl: string | null;
  }>,
  submissions: SpeakingRow[],
) {
  return exercises.map((exercise, index) => {
    const row = latest(submissions.filter((s) => s.exerciseId === exercise.id));
    const fb =
      row?.aiFeedback && typeof row.aiFeedback === 'object'
        ? (row.aiFeedback as Record<string, unknown>)
        : {};
    return {
      number: index + 1,
      exerciseId: exercise.id,
      title: exercise.title,
      taskType: exercise.taskType,
      prompt: exercise.targetText,
      imageUrl: exercise.imageUrl,
      status: speakingTaskStatus(row),
      submission: row
        ? {
            id: row.id,
            submittedAt: row.submittedAt,
            overallScore: row.overallScore,
            transcript: row.transcript,
            // Recording is fetched separately through a short-lived signed
            // URL; only whether one exists is exposed here.
            hasRecording: Boolean(row.audioKey || row.audioUrl),
            criteria: {
              accuracy: num(fb.accuracyScore),
              fluency: num(fb.fluencyScore),
              completeness: num(fb.completenessScore),
              prosody: num(fb.prosodyScore),
            },
            feedback: typeof fb.feedback === 'string' ? fb.feedback : null,
            suggestions: Array.isArray(fb.suggestions)
              ? fb.suggestions.filter((s): s is string => typeof s === 'string')
              : [],
          }
        : null,
    };
  });
}

function parseWritingFeedback(raw: string | null) {
  try {
    const value = JSON.parse(raw ?? 'null') as Record<string, unknown> | null;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function reviewWritingTasks(
  items: Array<{
    writingQuizId: number;
    taskKind: string;
    writingQuiz: { title: string } | null;
  }>,
  submissions: WritingRow[],
) {
  return items.map((item, index) => {
    const row = latest(
      submissions.filter((s) => s.quizId === item.writingQuizId),
    );
    const fb = parseWritingFeedback(row?.aiFeedback ?? null);
    const criteria = Array.isArray(fb.criteria)
      ? (fb.criteria as Array<Record<string, unknown>>).map((c) => ({
          label: typeof c.label === 'string' ? c.label : String(c.key ?? ''),
          score: num(c.score),
          max: num(c.max),
          comment: typeof c.comment === 'string' ? c.comment : null,
        }))
      : [];
    return {
      number: index + 1,
      quizId: item.writingQuizId,
      taskKind: item.taskKind,
      title: item.writingQuiz?.title ?? `Câu ${index + 1}`,
      status: !row
        ? 'NOT_SUBMITTED'
        : row.score === null
          ? 'PENDING'
          : 'GRADED',
      submission: row
        ? {
            id: row.id,
            submittedAt: row.submittedAt,
            score: row.score,
            maxScore: num(fb.maxScore),
            criteria,
            feedback: typeof fb.feedback === 'string' ? fb.feedback : null,
          }
        : null,
    };
  });
}
