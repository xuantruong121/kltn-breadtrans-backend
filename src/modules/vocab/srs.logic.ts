/**
 * Review schedule of one vocabulary word for one learner: an SM-2 variant
 * with the four self-ratings of the flashcard room. Pure: no I/O, no clock
 * of its own.
 *
 * A word carries an interval (days until the next review) and an ease factor
 * (how fast that interval grows). A right answer multiplies the interval by
 * the ease; "Học lại" brings the word back in ten minutes and lowers the
 * ease, so a word the learner keeps forgetting comes back more often than
 * one they know.
 */
export const SRS_GRADES = ['AGAIN', 'HARD', 'GOOD', 'EASY'] as const;
export type SrsGrade = (typeof SRS_GRADES)[number];

export type SrsState = {
  /** Days between the last review and the next; 0 for a new or lapsed word. */
  intervalDays: number;
  easeFactor: number;
  lapses: number;
};

export const SRS_START: SrsState = {
  intervalDays: 0,
  easeFactor: 2.5,
  lapses: 0,
};

export const SRS_RELEARN_MINUTES = 10;
export const SRS_MIN_EASE = 1.3;
export const SRS_MAX_EASE = 3.0;
export const SRS_MAX_INTERVAL_DAYS = 365;

const FIRST_INTERVAL: Record<Exclude<SrsGrade, 'AGAIN'>, number> = {
  HARD: 1,
  GOOD: 1,
  EASY: 4,
};
const EASE_STEP: Record<SrsGrade, number> = {
  AGAIN: -0.2,
  HARD: -0.15,
  GOOD: 0,
  EASY: 0.15,
};

export function isSrsGrade(value: unknown): value is SrsGrade {
  return SRS_GRADES.includes(value as SrsGrade);
}

const clampEase = (ease: number) =>
  Math.round(Math.min(SRS_MAX_EASE, Math.max(SRS_MIN_EASE, ease)) * 100) / 100;

/** A stored row may hold nulls or values written before the columns existed. */
export function srsStateOf(row?: Partial<SrsState> | null): SrsState {
  const interval = Number(row?.intervalDays);
  const ease = Number(row?.easeFactor);
  const lapses = Number(row?.lapses);
  return {
    intervalDays:
      Number.isFinite(interval) && interval > 0
        ? Math.min(SRS_MAX_INTERVAL_DAYS, Math.round(interval))
        : 0,
    easeFactor: Number.isFinite(ease) && ease > 0 ? clampEase(ease) : 2.5,
    lapses: Number.isFinite(lapses) && lapses > 0 ? Math.round(lapses) : 0,
  };
}

/** The state after one rating. The interval always grows on a right answer. */
export function rateSrs(state: SrsState, grade: SrsGrade): SrsState {
  const easeFactor = clampEase(state.easeFactor + EASE_STEP[grade]);
  if (grade === 'AGAIN') {
    return { intervalDays: 0, easeFactor, lapses: state.lapses + 1 };
  }
  let next: number;
  if (state.intervalDays < 1) {
    next = FIRST_INTERVAL[grade];
  } else {
    const factor =
      grade === 'HARD'
        ? 1.2
        : grade === 'GOOD'
          ? state.easeFactor
          : state.easeFactor * 1.3;
    next = Math.max(
      state.intervalDays + 1,
      Math.round(state.intervalDays * factor),
    );
  }
  return {
    intervalDays: Math.min(SRS_MAX_INTERVAL_DAYS, next),
    easeFactor,
    lapses: state.lapses,
  };
}

export function nextReviewAt(state: SrsState, now: Date): Date {
  const ms =
    state.intervalDays < 1
      ? SRS_RELEARN_MINUTES * 60_000
      : state.intervalDays * 86_400_000;
  return new Date(now.getTime() + ms);
}

/** Days until the next review for each rating; 0 means "in ten minutes". */
export function previewSrs(state: SrsState): Record<SrsGrade, number> {
  return {
    AGAIN: 0,
    HARD: rateSrs(state, 'HARD').intervalDays,
    GOOD: rateSrs(state, 'GOOD').intervalDays,
    EASY: rateSrs(state, 'EASY').intervalDays,
  };
}
