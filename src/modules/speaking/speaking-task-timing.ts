/**
 * The one timing contract for Speaking tasks, used by the API (exercise
 * payload, upload validation, worker validation) and shown to the learner.
 *
 * TOEIC exam tasks follow the ETS TOEIC Speaking format, by question number
 * (the task's order 1-11 inside its exam set):
 *   Q1-2  Read a text aloud            prepare 45 s, respond 45 s
 *   Q3-4  Describe a picture           prepare 45 s, respond 30 s
 *   Q5-6  Respond to questions         prepare  3 s, respond 15 s
 *   Q7    Respond to questions         prepare  3 s, respond 30 s
 *   Q8-9  Respond using information    prepare  3 s, respond 15 s
 *         (45 s to read the information before question 8)
 *   Q10   Respond using information    prepare  3 s, respond 30 s
 *   Q11   Express an opinion           prepare 45 s, respond 60 s
 * Source: ETS, "TOEIC Speaking and Writing Tests" (ets.org/toeic/about/speaking-writing.html).
 * This is a format simulation, not ETS scoring.
 *
 * Ordinary practice keeps its untimed preparation and a 45 s answer, 60 s for
 * an opinion.
 */
export type SpeakingTaskTiming = {
  /** Seconds to read on-screen information before the first question (Q8). */
  readingSeconds: number;
  prepSeconds: number;
  responseSeconds: number;
};

/** Recordings may run this much past the limit (encoder flush, clock skew). */
export const SPEAKING_DURATION_TOLERANCE_MS = 1500;
/** No Speaking task anywhere allows more than this. */
export const SPEAKING_MAX_RESPONSE_SECONDS = 60;

const EXAM_BY_QUESTION: Record<number, SpeakingTaskTiming> = {
  1: { readingSeconds: 0, prepSeconds: 45, responseSeconds: 45 },
  2: { readingSeconds: 0, prepSeconds: 45, responseSeconds: 45 },
  3: { readingSeconds: 0, prepSeconds: 45, responseSeconds: 30 },
  4: { readingSeconds: 0, prepSeconds: 45, responseSeconds: 30 },
  5: { readingSeconds: 0, prepSeconds: 3, responseSeconds: 15 },
  6: { readingSeconds: 0, prepSeconds: 3, responseSeconds: 15 },
  7: { readingSeconds: 0, prepSeconds: 3, responseSeconds: 30 },
  8: { readingSeconds: 45, prepSeconds: 3, responseSeconds: 15 },
  9: { readingSeconds: 0, prepSeconds: 3, responseSeconds: 15 },
  10: { readingSeconds: 0, prepSeconds: 3, responseSeconds: 30 },
  11: { readingSeconds: 0, prepSeconds: 45, responseSeconds: 60 },
};

export function speakingTaskTiming(exercise: {
  taskType: string | null;
  order?: number | null;
  examTask: boolean;
}): SpeakingTaskTiming {
  if (exercise.examTask && exercise.order && EXAM_BY_QUESTION[exercise.order])
    return EXAM_BY_QUESTION[exercise.order];
  return {
    readingSeconds: 0,
    prepSeconds: 0,
    responseSeconds: exercise.taskType === 'EXPRESS_OPINION' ? 60 : 45,
  };
}

/** Longest recording accepted for a task, in milliseconds. */
export function maxRecordingMs(timing: SpeakingTaskTiming): number {
  return timing.responseSeconds * 1000 + SPEAKING_DURATION_TOLERANCE_MS;
}
