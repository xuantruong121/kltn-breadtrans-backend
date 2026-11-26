import type { PracticeSkill } from '@prisma/client';
import type { Recommendation } from './recommendation.logic';
import {
  dailyFrame,
  eventKey,
  skillDays,
  type TodayEvent,
} from './today-frame.logic';

const pick = (
  skill: PracticeSkill,
  id: number,
  status: Recommendation['status'] = 'OPEN',
): Recommendation => ({
  candidate: {
    type: skill === 'SPEAKING' ? 'SPEAKING_SET' : 'QUIZ',
    id,
    skill,
    level: 'BASIC',
    title: `${skill} ${id}`,
    route: `/x/${id}`,
    difficulty: 0,
    tracks: [],
    kinds: [],
    planLocked: status === 'LOCKED_PLAN',
    requiredPlan: 'FREE',
    minutes: 10,
  },
  status,
  score: 1,
  predictedSuccess: 0.7,
  reasons: [],
});
const allPicks = {
  LISTENING: pick('LISTENING', 1),
  READING: pick('READING', 2),
  SPEAKING: pick('SPEAKING', 30),
  WRITING: pick('WRITING', 4),
};
const at = (h: number) => new Date(Date.UTC(2026, 10, 26, h));
const event = (
  skill: PracticeSkill,
  contentId: number,
  scorePercent: number,
  hour: number,
): TodayEvent => ({
  skill,
  contentType: skill === 'SPEAKING' ? 'SPEAKING_SET' : 'QUIZ',
  contentId,
  scorePercent,
  createdAt: at(hour),
});
const setKeys = new Map([
  [30, 30],
  [31, 30],
  [32, 30],
]);
const daysOf = (events: TodayEvent[], time: [string, number][] = []) =>
  skillDays(
    events,
    time.map(([skill, seconds]) => ({ skill, seconds })),
    setKeys,
  );

describe('skillDays', () => {
  it('counts distinct items per skill and keeps the last attempt', () => {
    const days = daysOf([
      event('LISTENING', 7, 50, 2),
      event('LISTENING', 7, 80, 3),
      event('LISTENING', 9, 60, 4),
    ]);
    expect(days.LISTENING).toEqual({
      seconds: 0,
      items: 2,
      last: { key: 'QUIZ:9', scorePercent: 60 },
    });
    expect(days.READING.items).toBe(0);
  });

  it('counts the exercises of one speaking set as one item', () => {
    const days = daysOf([
      event('SPEAKING', 31, 70, 2),
      event('SPEAKING', 32, 90, 3),
    ]);
    expect(days.SPEAKING.items).toBe(1);
    expect(days.SPEAKING.last).toEqual({
      key: 'SPEAKING_SET:30',
      scorePercent: 90,
    });
  });

  it('adds the study time of the four skills and ignores the rest', () => {
    const days = daysOf(
      [],
      [
        ['LISTENING', 600],
        ['LISTENING', 300],
        ['VOCAB', 900],
        ['EXAM', 1200],
      ],
    );
    expect(days.LISTENING.seconds).toBe(900);
    expect(days.READING.seconds).toBe(0);
  });

  it('finds the set of an unknown speaking exercise by itself', () => {
    expect(
      eventKey({ contentType: 'SPEAKING_SET', contentId: 99 }, setKeys),
    ).toBe('SPEAKING_SET:99');
  });
});

describe('dailyFrame', () => {
  it('an empty day gives four slots to do, one per skill, and no nudge', () => {
    const { slots, balance } = dailyFrame(allPicks, daysOf([]));
    expect(slots.map((s) => [s.skill, s.state])).toEqual([
      ['LISTENING', 'TODO'],
      ['READING', 'TODO'],
      ['SPEAKING', 'TODO'],
      ['WRITING', 'TODO'],
    ]);
    expect(balance).toBeNull();
  });

  it('a skill practised today stays done with its last item and score', () => {
    const { slots } = dailyFrame(
      allPicks,
      daysOf([event('READING', 12, 80, 5)]),
    );
    const reading = slots.find((s) => s.skill === 'READING')!;
    expect(reading).toMatchObject({
      state: 'DONE',
      pick: null,
      doneKey: 'QUIZ:12',
      done: { items: 1, scorePercent: 80 },
    });
  });

  it('keeps a locked pick and calls a skill with nothing EMPTY', () => {
    const { slots } = dailyFrame(
      { ...allPicks, SPEAKING: pick('SPEAKING', 30, 'LOCKED_PLAN') },
      daysOf([]),
    );
    expect(slots[2].pick?.status).toBe('LOCKED_PLAN');
    const none = dailyFrame(
      { LISTENING: allPicks.LISTENING },
      daysOf([]),
    ).slots;
    expect(none.map((s) => s.state)).toEqual([
      'TODO',
      'EMPTY',
      'EMPTY',
      'EMPTY',
    ]);
  });

  it('25 minutes of listening nudges the open skills not touched today', () => {
    const { slots, balance } = dailyFrame(
      allPicks,
      daysOf([event('LISTENING', 1, 70, 3)], [['LISTENING', 1500]]),
    );
    expect(balance).toEqual({
      skill: 'LISTENING',
      minutes: 25,
      items: 1,
      suggest: ['READING', 'SPEAKING', 'WRITING'],
    });
    expect(slots.filter((s) => s.nudged).map((s) => s.skill)).toEqual([
      'READING',
      'SPEAKING',
      'WRITING',
    ]);
  });

  it('19 minutes of one skill is not a lot yet', () => {
    expect(
      dailyFrame(allPicks, daysOf([], [['LISTENING', 19 * 60]])).balance,
    ).toBeNull();
  });

  it('three reading items in a day count as a lot', () => {
    const { balance } = dailyFrame(
      allPicks,
      daysOf([
        event('READING', 1, 90, 1),
        event('READING', 2, 90, 2),
        event('READING', 3, 90, 3),
      ]),
    );
    expect(balance).toMatchObject({ skill: 'READING', items: 3 });
  });

  it('two skills over the line: the one with more minutes is named', () => {
    const { balance } = dailyFrame(
      allPicks,
      daysOf(
        [],
        [
          ['LISTENING', 1300],
          ['READING', 2000],
        ],
      ),
    );
    expect(balance?.skill).toBe('READING');
    expect(balance?.suggest).toEqual(['SPEAKING', 'WRITING']);
  });

  it('no nudge when every other skill was touched or has no open item', () => {
    const { balance } = dailyFrame(
      {
        LISTENING: allPicks.LISTENING,
        SPEAKING: pick('SPEAKING', 30, 'LOCKED_PLAN'),
      },
      daysOf(
        [event('LISTENING', 1, 70, 2), event('WRITING', 4, 70, 3)],
        [['LISTENING', 1500]],
      ),
    );
    expect(balance).toBeNull();
  });

  it('a skill with a few minutes today but no item is not suggested', () => {
    const { balance } = dailyFrame(
      allPicks,
      daysOf(
        [],
        [
          ['LISTENING', 1500],
          ['WRITING', 400],
        ],
      ),
    );
    expect(balance?.suggest).toEqual(['READING', 'SPEAKING']);
  });
});
