import {
  MAX_SECONDS_PER_DAY,
  answerCount,
  creditedSeconds,
  daysInRange,
  skillBreakdown,
  summaryRange,
  tileOfQuizType,
  withVocabCount,
} from './learning-summary.logic';

// Instants carry their offset, so the expectations hold on any server timezone.
const now = new Date('2026-11-26T15:30:00+07:00'); // Thursday

describe('creditedSeconds', () => {
  it('takes at most two minutes from one report', () => {
    expect(creditedSeconds(60, 0)).toBe(60);
    expect(creditedSeconds(500, 0)).toBe(120);
    expect(creditedSeconds(-5, 0)).toBe(0);
    expect(creditedSeconds(45.9, 0)).toBe(45);
  });

  it('never lets a day pass twelve hours', () => {
    expect(creditedSeconds(120, MAX_SECONDS_PER_DAY - 30)).toBe(30);
    expect(creditedSeconds(120, MAX_SECONDS_PER_DAY)).toBe(0);
  });
});

describe('summaryRange (learner days, Vietnam time, turning at 00:01)', () => {
  it('today, this week from Monday, this month from the 1st', () => {
    expect(summaryRange('today', now)).toMatchObject({
      start: new Date('2026-11-26T00:01:00+07:00'),
      startKey: '2026-11-26',
      endKey: '2026-11-26',
    });
    expect(summaryRange('week', now)).toMatchObject({
      start: new Date('2026-11-23T00:01:00+07:00'),
      startKey: '2026-11-23',
    });
    expect(summaryRange('month', now)).toMatchObject({
      start: new Date('2026-11-01T00:01:00+07:00'),
      startKey: '2026-11-01',
    });
    expect(summaryRange('all', now)).toMatchObject({
      start: null,
      startKey: null,
      endKey: '2026-11-26',
    });
  });

  it('a custom range runs from its first day to the end of its last, never past now', () => {
    const r = summaryRange('custom', now, '2026-11-01', '2026-11-15');
    expect(r.start).toEqual(new Date('2026-11-01T00:01:00+07:00'));
    expect(r.end).toEqual(new Date('2026-11-16T00:01:00+07:00'));
    expect(r).toMatchObject({ startKey: '2026-11-01', endKey: '2026-11-15' });
    const future = summaryRange('custom', now, '2026-11-20', '2026-12-31');
    expect(future.end).toEqual(now);
    expect(future.endKey).toBe('2026-11-26');
  });

  it('refuses a missing, reversed or over-a-year custom range', () => {
    expect(() => summaryRange('custom', now)).toThrow();
    expect(() =>
      summaryRange('custom', now, '2026-11-20', '2026-11-10'),
    ).toThrow();
    expect(() =>
      summaryRange('custom', now, '2025-01-01', '2026-11-20'),
    ).toThrow();
  });
});

describe('counting helpers', () => {
  it('answerCount reads an array or an object of answers', () => {
    expect(answerCount([1, 2, 3])).toBe(3);
    expect(answerCount({ a: 1, b: 2 })).toBe(2);
    expect(answerCount(null)).toBe(0);
  });

  it('tileOfQuizType puts writing kinds together and leaves TOEIC quizzes out', () => {
    expect(tileOfQuizType('LISTENING_PRACTICE')).toBe('LISTENING');
    expect(tileOfQuizType('BILINGUAL_READING')).toBe('READING');
    expect(tileOfQuizType('WRITING_PICTURE')).toBe('WRITING');
    expect(tileOfQuizType('WRITING_EMAIL')).toBe('WRITING');
    expect(tileOfQuizType('TOEIC')).toBeNull();
  });

  it('skillBreakdown counts items, seconds and the learner days with either', () => {
    const s = skillBreakdown({
      done: [
        ['LISTENING', new Date('2026-11-24T10:00:00+07:00')],
        ['LISTENING', new Date('2026-11-24T20:00:00+07:00')],
        // 00:00:30 still belongs to the day before (the day turns at 00:01)
        ['LISTENING', new Date('2026-11-26T00:00:30+07:00')],
      ],
      time: [
        { dayKey: '2026-11-26', skill: 'LISTENING', seconds: 300 },
        { dayKey: '2026-11-26', skill: 'GRAMMAR', seconds: 120 },
        { dayKey: '2026-11-23', skill: 'READING', seconds: 0 },
      ],
    });
    expect(s.LISTENING).toEqual({ count: 3, seconds: 300, days: 3 });
    expect(s.READING).toEqual({ count: 0, seconds: 0, days: 0 });
  });

  it('withVocabCount sets the Flashcard count only when asked', () => {
    const skills = skillBreakdown({ done: [], time: [] });
    expect(withVocabCount(skills, null)).toBe(skills);
    expect(withVocabCount(skills, 5).VOCAB.count).toBe(5);
  });

  it('daysInRange counts both ends; an open range has none', () => {
    expect(daysInRange('2026-11-23', '2026-11-26')).toBe(4);
    expect(daysInRange('2026-11-26', '2026-11-26')).toBe(1);
    expect(daysInRange(null, '2026-11-26')).toBeNull();
  });
});
