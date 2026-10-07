import {
  buildDailyPracticePlan,
  DailyPracticeSkillProgress,
} from './adaptive-daily-practice.service';
import { DailyPracticeCandidate } from './adaptive-daily-practice.service';

function skill(
  name: DailyPracticeSkillProgress['skill'],
  overrides: Partial<DailyPracticeSkillProgress> = {},
): DailyPracticeSkillProgress {
  return {
    skill: name,
    title: name,
    categoryLabel: name,
    totalItems: 0,
    completedItems: 0,
    progressPercent: 0,
    levelRange: 'A1 - C1',
    badge: '',
    unitLabel: 'lượt luyện',
    completedAttempts: 0,
    normalizedScore: null,
    recentAverage: null,
    trend: 'INSUFFICIENT_DATA',
    strongestDimension: null,
    weakestDimension: null,
    lastPracticedAt: null,
    status: 'INSUFFICIENT_DATA',
    statusLabel: 'Chưa đủ dữ liệu',
    hasEnoughData: false,
    dimensions: [],
    ...overrides,
  };
}

function candidate(
  skillName: DailyPracticeCandidate['skill'],
  id: number,
  overrides: Partial<DailyPracticeCandidate> = {},
): DailyPracticeCandidate {
  return {
    skill: skillName,
    exerciseId: id,
    title: `${skillName} ${id}`,
    route: `/practice/${skillName.toLowerCase()}/${id}`,
    estimatedMinutes: 5,
    dimensions: [],
    isLocked: false,
    isCompleted: false,
    practicedBeforeToday: false,
    ...overrides,
  };
}

describe('AdaptiveDailyPracticeService deterministic planner', () => {
  it('returns a balanced starter plan without labelling a fresh learner weak', () => {
    const result = buildDailyPracticePlan(
      7,
      '2026-10-07',
      [
        skill('LISTENING'),
        skill('READING'),
        skill('SPEAKING'),
        skill('WRITING'),
      ],
      [
        candidate('LISTENING', 1),
        candidate('READING', 2),
        candidate('SPEAKING', 3),
        candidate('WRITING', 4),
      ],
    );

    expect(result.items).toHaveLength(3);
    expect(result.items.map((item) => item.skill)).toEqual([
      'LISTENING',
      'READING',
      'SPEAKING',
    ]);
    expect(result.reasonSummary).toBe('Khám phá trình độ của bạn');
    expect(
      result.items.every((item) => item.reasonCode === 'BALANCED_START'),
    ).toBe(true);
  });

  it('prioritises the lowest adequately-sampled skill and its supported dimension', () => {
    const result = buildDailyPracticePlan(
      7,
      '2026-10-07',
      [
        skill('LISTENING', {
          completedAttempts: 4,
          normalizedScore: 75,
          recentAverage: 75,
          hasEnoughData: true,
          status: 'GOOD',
        }),
        skill('READING', {
          completedAttempts: 4,
          normalizedScore: 40,
          recentAverage: 40,
          weakestDimension: 'INFERENCE',
          hasEnoughData: true,
          status: 'NEEDS_IMPROVEMENT',
        }),
        skill('SPEAKING', {
          completedAttempts: 4,
          normalizedScore: 70,
          recentAverage: 70,
          hasEnoughData: true,
          status: 'PROGRESSING',
        }),
        skill('WRITING', {
          completedAttempts: 4,
          normalizedScore: 80,
          recentAverage: 80,
          hasEnoughData: true,
          status: 'GOOD',
        }),
      ],
      [
        candidate('READING', 22, { dimensions: ['INFERENCE'] }),
        candidate('READING', 23, { dimensions: ['DETAIL'] }),
        candidate('LISTENING', 1),
        candidate('SPEAKING', 2),
      ],
    );

    expect(result.items[0]).toMatchObject({
      skill: 'READING',
      exerciseId: 22,
      reasonCode: 'WEAKEST_DIMENSION',
      dimension: 'INFERENCE',
    });
  });

  it('keeps the required plan stable for unchanged state and avoids old alternatives', () => {
    const skills = [
      skill('LISTENING', {
        completedAttempts: 3,
        normalizedScore: 60,
        recentAverage: 60,
        hasEnoughData: true,
      }),
      skill('READING', {
        completedAttempts: 3,
        normalizedScore: 70,
        recentAverage: 70,
        hasEnoughData: true,
      }),
      skill('SPEAKING', {
        completedAttempts: 3,
        normalizedScore: 80,
        recentAverage: 80,
        hasEnoughData: true,
      }),
    ];
    const candidates = [
      candidate('LISTENING', 10, { practicedBeforeToday: true }),
      candidate('LISTENING', 11),
      candidate('READING', 20),
      candidate('SPEAKING', 30),
    ];
    const first = buildDailyPracticePlan(7, '2026-10-07', skills, candidates);
    const second = buildDailyPracticePlan(7, '2026-10-07', skills, candidates);

    expect(second.items).toEqual(first.items);
    expect(first.items[0].exerciseId).toBe(11);
  });

  it('marks completed evidence without changing the target count', () => {
    const result = buildDailyPracticePlan(
      7,
      '2026-10-07',
      [
        skill('LISTENING', {
          completedAttempts: 3,
          normalizedScore: 60,
          recentAverage: 60,
          hasEnoughData: true,
        }),
        skill('READING'),
      ],
      [
        candidate('LISTENING', 10, { isCompleted: true }),
        candidate('READING', 20),
      ],
    );

    expect(result.targetActivities).toBe(2);
    expect(result.completedCount).toBe(1);
    expect(result.items[0].isCompleted).toBe(true);
  });

  it('uses a safe plans route for a locked-only candidate', () => {
    const result = buildDailyPracticePlan(
      7,
      '2026-10-07',
      [skill('LISTENING')],
      [candidate('LISTENING', 99, { isLocked: true })],
    );

    expect(result.items[0]).toMatchObject({
      isLocked: true,
      route: '/plans?highlight=plus',
      reasonCode: 'ACCESS_LOCKED',
    });
  });
});
