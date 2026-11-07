/**
 * How long a Practice by Part attempt lasts. It used to take the whole exam's
 * 120 minutes whatever was chosen, so a Part 5 practice counted down from
 * 120:00 (audit 2026-11-06).
 *
 * Listening minutes follow the recorded audio of the published exams plus
 * response gaps (Part 1 about 2.9, Part 2 9.2, Part 3 18, Part 4 13.5 minutes
 * in the listening masters); Reading follows the usual split of its 75
 * minutes. The seven Parts add up to the 120 minutes of a Full Test.
 * The frontend shows the same table (src/lib/toeic/practiceDuration.ts).
 */
export const PRACTICE_PART_MINUTES: Readonly<Record<number, number>> = {
  1: 5,
  2: 9,
  3: 17,
  4: 14,
  5: 11,
  6: 8,
  7: 56,
};

/** Seconds for the chosen Parts; no Part chosen means the whole exam. */
export function practiceDurationSeconds(
  selectedParts: readonly number[],
  examDurationSeconds: number,
) {
  const parts = [...new Set(selectedParts)].filter(
    (part) => PRACTICE_PART_MINUTES[part] !== undefined,
  );
  if (!parts.length) return examDurationSeconds;
  const seconds = parts.reduce(
    (sum, part) => sum + PRACTICE_PART_MINUTES[part] * 60,
    0,
  );
  return Math.min(seconds, examDurationSeconds);
}
