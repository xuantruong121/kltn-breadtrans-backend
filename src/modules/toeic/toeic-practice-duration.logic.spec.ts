import {
  PRACTICE_PART_MINUTES,
  practiceDurationSeconds,
} from './toeic-practice-duration.logic';

describe('Practice by Part duration', () => {
  it('gives a Part 5 practice 11 minutes, not the whole exam', () => {
    expect(practiceDurationSeconds([5], 7200)).toBe(660);
  });

  it('adds the chosen Parts', () => {
    expect(practiceDurationSeconds([3, 4, 7], 7200)).toBe((17 + 14 + 56) * 60);
  });

  it('adds up to the Full Test time for all seven Parts', () => {
    const total = Object.values(PRACTICE_PART_MINUTES).reduce((a, b) => a + b);
    expect(total).toBe(120);
    expect(practiceDurationSeconds([1, 2, 3, 4, 5, 6, 7], 7200)).toBe(7200);
  });

  it('keeps the exam duration when no Part is chosen', () => {
    expect(practiceDurationSeconds([], 7200)).toBe(7200);
  });

  it('never exceeds the exam duration and ignores unknown Parts', () => {
    expect(practiceDurationSeconds([7, 7, 9], 3000)).toBe(3000);
    expect(practiceDurationSeconds([9], 7200)).toBe(7200);
  });
});
