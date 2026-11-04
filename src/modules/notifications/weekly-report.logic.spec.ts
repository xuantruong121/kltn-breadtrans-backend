import {
  PRACTICE_SCORE_NOTE,
  daysUntil,
  focusSkill,
  lastWeekLabel,
  summarizeWeeks,
  weeklyReportMessage,
  weeklyReportType,
  type SkillWeek,
} from './weekly-report.logic';

// Monday 2026-11-02 00:00 in Vietnam.
const weekStart = new Date('2026-11-02T00:00:00+07:00');
const at = (iso: string) => new Date(iso);
const targets = { LISTENING: 4, READING: 4, SPEAKING: 2, WRITING: 2 };

describe('summarizeWeeks', () => {
  it('counts last week and averages both weeks per skill', () => {
    const skills = summarizeWeeks({
      weekStart,
      targets,
      events: [
        // Last week: Mon 26/10 .. Sun 01/11.
        {
          skill: 'READING',
          scorePercent: 80,
          createdAt: at('2026-10-26T00:00:00+07:00'),
        },
        {
          skill: 'READING',
          scorePercent: 70,
          createdAt: at('2026-11-01T23:59:00+07:00'),
        },
        // The week before.
        {
          skill: 'READING',
          scorePercent: 60,
          createdAt: at('2026-10-20T10:00:00+07:00'),
        },
        // This week: not counted.
        {
          skill: 'READING',
          scorePercent: 10,
          createdAt: at('2026-11-02T00:00:00+07:00'),
        },
      ],
    });
    const reading = skills.find((s) => s.skill === 'READING')!;
    expect(reading).toEqual({
      skill: 'READING',
      count: 2,
      average: 75,
      previousAverage: 60,
      target: 4,
    });
    expect(skills.find((s) => s.skill === 'WRITING')!.average).toBeNull();
  });
});

const week = (
  over: Partial<SkillWeek> & Pick<SkillWeek, 'skill'>,
): SkillWeek => ({
  count: 0,
  average: null,
  previousAverage: null,
  target: 2,
  ...over,
});

describe('focusSkill', () => {
  it('picks the skill furthest behind its target', () => {
    const focus = focusSkill([
      week({ skill: 'LISTENING', count: 3, target: 4 }),
      week({ skill: 'READING', count: 4, target: 4 }),
      week({ skill: 'SPEAKING', count: 1, target: 2 }),
      week({ skill: 'WRITING', count: 0, target: 2 }),
    ]);
    expect(focus?.skill).toBe('WRITING');
  });

  it('breaks a tie towards the larger target', () => {
    const focus = focusSkill([
      week({ skill: 'LISTENING', count: 0, target: 4 }),
      week({ skill: 'WRITING', count: 0, target: 2 }),
    ]);
    expect(focus?.skill).toBe('LISTENING');
  });

  it('returns nothing when every target is met', () => {
    expect(
      focusSkill([week({ skill: 'READING', count: 2, target: 2 })]),
    ).toBeNull();
  });
});

describe('daysUntil and lastWeekLabel', () => {
  it('counts Vietnam calendar days', () => {
    expect(
      daysUntil(
        at('2026-11-10T08:00:00+07:00'),
        at('2026-11-02T23:00:00+07:00'),
      ),
    ).toBe(8);
    expect(daysUntil(null, weekStart)).toBeNull();
  });

  it('labels the week before Monday', () => {
    expect(lastWeekLabel(weekStart)).toBe('26/10 – 01/11');
  });
});

describe('weeklyReportMessage', () => {
  it('reports the week, the best rise, the focus and the exam countdown', () => {
    const message = weeklyReportMessage({
      weekStart,
      daysToExam: 45,
      skills: [
        week({
          skill: 'LISTENING',
          count: 4,
          target: 4,
          average: 70,
          previousAverage: 68,
        }),
        week({
          skill: 'READING',
          count: 3,
          target: 4,
          average: 72,
          previousAverage: 64,
        }),
        week({ skill: 'SPEAKING', count: 2, target: 2 }),
        week({ skill: 'WRITING', count: 0, target: 2 }),
      ],
    });
    expect(message.title).toBe('Tuần qua bạn luyện 9 bài');
    expect(message.body).toContain(
      'Tuần 26/10 – 01/11 bạn đã luyện 9 bài (Nghe 4, Đọc 3, Nói 2).',
    );
    expect(message.body).toContain(
      'Đọc: điểm luyện tập trung bình 72%, tăng 8 điểm so với tuần trước.',
    );
    expect(message.body).toContain(
      'Tuần này nên ưu tiên Viết: mục tiêu 2 bài.',
    );
    expect(message.body).toContain('Còn 45 ngày tới ngày thi bạn đặt.');
    expect(message.body).toContain(PRACTICE_SCORE_NOTE);
    expect(message.url).toBe('/dashboard');
  });

  it('nudges a learner who did nothing, without a score note', () => {
    const message = weeklyReportMessage({
      weekStart,
      daysToExam: null,
      skills: [week({ skill: 'READING', target: 4 })],
    });
    expect(message.title).toBe('Tuần mới, bắt đầu lại nhé');
    expect(message.body).toContain('bạn chưa luyện bài nào');
    expect(message.body).not.toContain(PRACTICE_SCORE_NOTE);
    expect(message.body).not.toContain('ngày thi');
  });

  it('never claims an official or CEFR result', () => {
    const { body } = weeklyReportMessage({
      weekStart,
      daysToExam: 3,
      skills: [
        week({ skill: 'READING', count: 1, average: 90, previousAverage: 80 }),
      ],
    });
    expect(body).not.toMatch(/ETS|CEFR|\b[ABC][12]\b/);
  });

  it('uses one notification type per week', () => {
    expect(weeklyReportType('2026-11-02')).toBe('weekly_report:2026-11-02');
  });
});
