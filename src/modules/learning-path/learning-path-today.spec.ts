import type { PracticeSkill } from '@prisma/client';

import { LearningPathService } from './learning-path.service';
import { loadCandidates, loadLearnerState } from './learning-path.catalog';
import type { Candidate } from './recommendation.logic';

jest.mock('./learning-path.catalog', () => ({
  loadCandidates: jest.fn(),
  loadLearnerState: jest.fn(),
}));

const item = (
  skill: PracticeSkill,
  id: number,
  type: Candidate['type'] = 'QUIZ',
): Candidate => ({
  type,
  id,
  skill,
  level: 'BASIC',
  title: `${skill} ${id}`,
  route: `/r/${id}`,
  difficulty: -0.5,
  tracks: [],
  kinds: [],
  planLocked: false,
  requiredPlan: 'FREE',
  minutes: skill === 'WRITING' ? 15 : 10,
});
const CANDIDATES = [
  item('LISTENING', 1),
  item('LISTENING', 2),
  item('READING', 3),
  item('READING', 6),
  item('SPEAKING', 30, 'SPEAKING_SET'),
  item('WRITING', 5),
];
// 10:00 on 26/11 in Vietnam; the learner day began at 00:01 Vietnam time.
const NOW = new Date('2026-11-26T03:00:00.000Z');
const DAY_START = new Date('2026-11-25T17:01:00.000Z');

function service(
  events: unknown[] = [],
  time: { skill: string; seconds: number }[] = [],
) {
  (loadCandidates as jest.Mock).mockResolvedValue({
    candidates: CANDIDATES,
    setKeyOfExercise: new Map([
      [30, 30],
      [31, 30],
    ]),
  });
  (loadLearnerState as jest.Mock).mockResolvedValue({
    track: 'GENERAL',
    trackName: 'Chung',
    goal: 'GENERAL',
    skills: {},
    history: new Map(),
    saved: new Set(),
    weakFocus: [],
    now: NOW,
    minutesPerDay: 15,
  });
  const db = {
    learnerProgressEvent: {
      findMany: jest.fn().mockResolvedValue(events),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    studyTime: { findMany: jest.fn().mockResolvedValue(time) },
    learnerProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    grammarTopic: { findMany: jest.fn().mockResolvedValue([]) },
    grammarAttempt: { findMany: jest.fn().mockResolvedValue([]) },
    vocabTopic: { findMany: jest.fn().mockResolvedValue([]) },
    userVocabWordProgress: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = new LearningPathService(
    db as never,
    { effectivePlanCode: () => Promise.resolve(null) } as never,
    {
      unlockedLevels: () =>
        Promise.resolve({
          LISTENING: 'BASIC',
          READING: 'BASIC',
          SPEAKING: 'BASIC',
          WRITING: 'BASIC',
        }),
    } as never,
  );
  return { svc, db };
}

describe('LearningPathService.today: four skills a day (2026-11-26)', () => {
  it('gives one slot per skill and keeps a skill done today as done', async () => {
    const { svc, db } = service([
      {
        skill: 'LISTENING',
        contentType: 'QUIZ',
        contentId: 1,
        scorePercent: 80,
        createdAt: new Date('2026-11-26T02:00:00.000Z'),
      },
    ]);
    const today = await svc.today(7, NOW);

    expect(db.learnerProgressEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7, createdAt: { gte: DAY_START } },
      }),
    );
    expect(db.studyTime.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7, dayKey: '2026-11-26' } }),
    );
    expect(today.dayKey).toBe('2026-11-26');
    expect(today.slots.map((s) => [s.skill, s.state])).toEqual([
      ['LISTENING', 'DONE'],
      ['READING', 'TODO'],
      ['SPEAKING', 'TODO'],
      ['WRITING', 'TODO'],
    ]);
    expect(today.slots[0]).toMatchObject({
      item: { contentId: 1, skill: 'LISTENING' },
      done: { items: 1, scorePercent: 80 },
    });
    expect(today.balance).toBeNull();
    // The old list keeps the open picks still to do.
    expect(today.items.map((i) => i.skill)).toEqual([
      'READING',
      'SPEAKING',
      'WRITING',
    ]);
    // "Bài khác" repeats neither the picks nor today's item.
    const picked = today.slots
      .filter((s) => s.state === 'TODO')
      .map((s) => `${s.item!.contentType}:${s.item!.contentId}`);
    const more = today.more.map((m) => `${m.contentType}:${m.contentId}`);
    expect(more).not.toContain('QUIZ:1');
    for (const key of picked) expect(more).not.toContain(key);
  });

  it('25 minutes of listening today suggests the skills not touched yet', async () => {
    const { svc } = service([], [{ skill: 'LISTENING', seconds: 1500 }]);
    const today = await svc.today(7, NOW);
    expect(today.balance).toEqual({
      skill: 'LISTENING',
      minutes: 25,
      items: 0,
      suggest: ['READING', 'SPEAKING', 'WRITING'],
    });
    expect(today.slots.filter((s) => s.nudged).map((s) => s.skill)).toEqual([
      'READING',
      'SPEAKING',
      'WRITING',
    ]);
  });

  it('a speaking exercise done today marks its set as done', async () => {
    const { svc } = service([
      {
        skill: 'SPEAKING',
        contentType: 'SPEAKING_SET',
        contentId: 31,
        scorePercent: 65,
        createdAt: new Date('2026-11-26T01:00:00.000Z'),
      },
    ]);
    const today = await svc.today(7, NOW);
    const speaking = today.slots.find((s) => s.skill === 'SPEAKING')!;
    expect(speaking).toMatchObject({
      state: 'DONE',
      item: { contentType: 'SPEAKING_SET', contentId: 30 },
      done: { items: 1, scorePercent: 65 },
    });
  });
});
