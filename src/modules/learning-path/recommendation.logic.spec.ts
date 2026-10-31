import type { PracticeLevel, PracticeSkill } from '@prisma/client';

import {
  dailyPlan,
  recommend,
  type Candidate,
  type LearnerState,
} from './recommendation.logic';

const NOW = new Date('2026-10-30T08:00:00Z');
const DIFF: Record<PracticeLevel, number> = {
  STARTER: -1.25,
  BASIC: -0.5,
  INTERMEDIATE: 0.5,
  ADVANCED: 1.6,
};
let nextId = 1;
const item = (
  skill: PracticeSkill,
  level: PracticeLevel,
  extra: Partial<Candidate> = {},
): Candidate => ({
  type: 'QUIZ',
  id: nextId++,
  skill,
  level,
  title: `${skill} ${level}`,
  route: `/x/${nextId}`,
  difficulty: DIFF[level],
  tracks: [],
  planLocked: false,
  requiredPlan: 'FREE',
  minutes: 10,
  ...extra,
});
const learner = (extra: Partial<LearnerState> = {}): LearnerState => ({
  track: 'GENERAL',
  skills: {
    LISTENING: { level: 'BASIC', unlockedLevel: 'BASIC', ability: -0.9 },
    READING: { level: 'BASIC', unlockedLevel: 'INTERMEDIATE', ability: -0.2 },
  },
  history: new Map(),
  saved: new Set(),
  now: NOW,
  ...extra,
});

describe('recommend', () => {
  it('prefers the learner level and explains why', () => {
    const own = item('READING', 'BASIC');
    const hard = item('READING', 'ADVANCED');
    const [first] = recommend([hard, own], learner(), {
      limit: 2,
      skill: 'READING',
    });
    expect(first.candidate).toBe(own);
    expect(first.reasons[0]).toBe('Vừa sức mức Cơ bản của bạn');
  });

  it('marks items above the unlocked level LOCKED_LEVEL and lists them last', () => {
    const locked = item('LISTENING', 'INTERMEDIATE');
    const open = item('LISTENING', 'BASIC');
    const r = recommend([locked, open], learner(), {
      limit: 5,
      skill: 'LISTENING',
      includeLocked: true,
    });
    expect(r.map((x) => x.status)).toEqual(['OPEN', 'LOCKED_LEVEL']);
    expect(r[1].reasons).toContain('Cần mở khóa mức Trung cấp');
    expect(
      recommend([locked], learner(), { limit: 5, skill: 'LISTENING' }),
    ).toEqual([]);
  });

  it('keeps plan locks visible with their reason', () => {
    const r = recommend(
      [item('READING', 'INTERMEDIATE', { planLocked: true })],
      learner(),
      { limit: 1, includeLocked: true },
    );
    expect(r[0].status).toBe('LOCKED_PLAN');
    expect(r[0].reasons).toContain('Cần gói PLUS hoặc PRO');
  });

  it('boosts the career track and the weakest skill', () => {
    const it1 = item('READING', 'BASIC', { tracks: ['IT_SOFTWARE'] });
    const plain = item('READING', 'BASIC');
    const r = recommend([plain, it1], learner({ track: 'IT_SOFTWARE' }), {
      limit: 2,
      skill: 'READING',
    });
    expect(r[0].candidate).toBe(it1);
    expect(r[0].reasons).toContain('Chủ đề Công nghệ thông tin');
    const mixed = recommend(
      [item('READING', 'BASIC'), item('LISTENING', 'BASIC')],
      learner(),
      { limit: 1 },
    );
    expect(mixed[0].candidate.skill).toBe('LISTENING');
    expect(mixed[0].reasons).toContain('Kỹ năng cần cải thiện: Nghe');
  });

  it('sinks mastered items and brings back low scores after two days', () => {
    const mastered = item('READING', 'BASIC');
    const weak = item('READING', 'BASIC');
    const fresh = item('READING', 'BASIC');
    const history = new Map([
      [`QUIZ:${mastered.id}`, { bestScore: 95, lastAt: NOW, attempts: 1 }],
      [
        `QUIZ:${weak.id}`,
        {
          bestScore: 40,
          lastAt: new Date(NOW.getTime() - 3 * 86_400_000),
          attempts: 1,
        },
      ],
    ]);
    const r = recommend([mastered, weak, fresh], learner({ history }), {
      limit: 3,
      skill: 'READING',
    });
    expect(r[r.length - 1].candidate).toBe(mastered);
    expect(r.find((x) => x.candidate === weak)!.reasons).toContain(
      'Ôn lại bài chưa đạt',
    );
  });

  it('ranks items two levels below last, as foundation review', () => {
    const tooEasy = item('READING', 'STARTER');
    const placed = learner({
      skills: {
        READING: {
          level: 'INTERMEDIATE',
          unlockedLevel: 'INTERMEDIATE',
          ability: 0.5,
        },
      },
    });
    const own = item('READING', 'INTERMEDIATE');
    const r = recommend([tooEasy, own], placed, { limit: 2 });
    expect(r.map((x) => x.candidate)).toEqual([own, tooEasy]);
    expect(r[1].reasons).toContain('Ôn nền tảng');
  });

  it('mixes skills without a filter', () => {
    const pool = [
      item('READING', 'BASIC'),
      item('READING', 'BASIC'),
      item('WRITING', 'BASIC'),
    ];
    const r = recommend(pool, learner(), { limit: 2 });
    expect(new Set(r.map((x) => x.candidate.skill)).size).toBe(2);
  });

  it('an unplaced skill is practised as Cơ bản, with higher levels locked', () => {
    const open = recommend([item('WRITING', 'BASIC')], learner(), {
      limit: 1,
      includeLocked: true,
    });
    expect(open[0].status).toBe('OPEN');
    const locked = recommend([item('WRITING', 'INTERMEDIATE')], learner(), {
      limit: 1,
      includeLocked: true,
    });
    expect(locked[0].status).toBe('LOCKED_LEVEL');
  });

  it('fills the day up to the learner minutes, at least one item', () => {
    const ranked = recommend(
      [
        item('READING', 'BASIC', { minutes: 10 }),
        item('LISTENING', 'BASIC', { minutes: 10 }),
        item('WRITING', 'BASIC', { minutes: 10 }),
      ],
      learner(),
      { limit: 3 },
    );
    expect(dailyPlan(ranked, 20)).toHaveLength(2);
    expect(dailyPlan(ranked, 5)).toHaveLength(1);
  });

  it('names no weakest skill when skills are level', () => {
    const even = learner({
      skills: {
        LISTENING: { level: 'BASIC', unlockedLevel: 'BASIC', ability: 0.25 },
        READING: { level: 'BASIC', unlockedLevel: 'BASIC', ability: 0.3 },
      },
    });
    const r = recommend([item('LISTENING', 'BASIC')], even, { limit: 1 });
    expect(r[0].reasons.join(' ')).not.toMatch(/cần cải thiện/);
  });
});
