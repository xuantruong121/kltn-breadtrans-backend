import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DungeonService } from './dungeon.service';
import {
  monsterHit,
  type DungeonQuestion,
  type RunState,
} from './dungeon.logic';

/** Just enough of ioredis for the service, in memory. */
class FakeRedis {
  store = new Map<string, string>();
  zset = new Map<string, number>();
  get(key: string) {
    return Promise.resolve(this.store.get(key) ?? null);
  }
  set(key: string, value: string, ...args: unknown[]) {
    if (args.includes('NX') && this.store.has(key))
      return Promise.resolve(null);
    this.store.set(key, value);
    return Promise.resolve('OK');
  }
  del(key: string) {
    this.store.delete(key);
    return Promise.resolve(1);
  }
  exists(key: string) {
    return Promise.resolve(this.store.has(key) ? 1 : 0);
  }
  zadd(_key: string, score: number, member: string) {
    this.zset.set(member, score);
    return Promise.resolve(1);
  }
  zrem(_key: string, member: string) {
    this.zset.delete(member);
    return Promise.resolve(1);
  }
  zrangebyscore(_key: string, min: number, max: number) {
    return Promise.resolve(
      [...this.zset].filter(([, s]) => s >= min && s <= max).map(([m]) => m),
    );
  }
}

const name = (i: number) =>
  `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`;
// Shuffled ids: the bank must not depend on the order the database returns.
const entries = Array.from({ length: 120 }, (_, i) => ({
  id: ((i * 37) % 120) + 1,
  headword: name(i),
  displayWord: name(i),
  pos: 'noun',
  meaningVi: `nghĩa số ${i}`,
  exampleEn: null,
  ipaUs: null,
  ipaUk: null,
  deckWords: [{ topic: { id: 1 + (i % 3), level: ['A2', 'B1', 'B2'][i % 3] } }],
}));

type Stored = {
  run: RunState;
  question: { q: DungeonQuestion; issuedAt: number } | null;
};

describe('DungeonService', () => {
  let redis: FakeRedis;
  let events: { userId: number; type: string; value: number }[];
  let gamification: {
    deductBanh: jest.Mock;
    awardBanh: jest.Mock;
    awardXp: jest.Mock;
  };
  let service: DungeonService;
  let now: number;
  let findMany: jest.Mock;

  beforeEach(() => {
    redis = new FakeRedis();
    events = [];
    now = Date.parse('2026-11-09T03:00:00Z');
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    gamification = {
      deductBanh: jest
        .fn()
        .mockResolvedValue({ success: true, newBalance: 80 }),
      awardBanh: jest
        .fn()
        .mockImplementation((_u, amount) =>
          Promise.resolve({ granted: amount }),
        ),
      awardXp: jest.fn().mockResolvedValue({}),
    };
    findMany = jest.fn().mockResolvedValue(entries);
    const prisma = {
      dictionaryEntry: { findMany },
      pointHistory: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { points: 0 } }),
      },
      learnerEvent: {
        create: jest.fn().mockImplementation(({ data }) => {
          events.push(data);
          return Promise.resolve(data);
        }),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              events.find(
                (e) => e.userId === where.userId && e.type === where.type,
              ) ?? null,
            ),
          ),
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockImplementation(({ where }) => {
          const mine = events.filter(
            (e) => e.userId === where.userId && e.type === where.type,
          );
          return Promise.resolve({
            _max: {
              value: mine.length ? Math.max(...mine.map((e) => e.value)) : null,
            },
          });
        }),
      },
    };
    service = new DungeonService(
      prisma as never,
      redis as never,
      gamification as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const stored = (id: string) =>
    JSON.parse(redis.store.get(`dungeon:run:${id}`)!) as Stored;
  const patch = (id: string, change: (s: Stored) => void) => {
    const s = JSON.parse(redis.store.get(`dungeon:run:${id}`)!);
    change(s);
    redis.store.set(`dungeon:run:${id}`, JSON.stringify(s));
  };
  const rightAnswer = (id: string) => {
    const q = stored(id).question!.q;
    return q.type === 'choice' ? { choice: q.correct } : { text: q.answers[0] };
  };
  const wrongAnswer = (id: string) => {
    const q = stored(id).question!.q;
    return q.type === 'choice'
      ? { choice: (q.correct + 1) % 4 }
      : { text: 'zzzz' };
  };

  it('opens a run: the ticket is taken once, the question carries no answer, the open run comes back', async () => {
    const view = await service.start(1, 'free');
    expect(gamification.deductBanh).toHaveBeenCalledWith(
      1,
      20,
      expect.any(String),
      'DUNGEON_STAKE',
      `dungeon:${view.sessionId}:stake`,
      expect.anything(),
    );
    expect(view.phase).toBe('fight');
    // The first question's clock starts after the intro, not while the page shows it.
    expect(view.questionStartsAt).toBe(now + 3000);
    expect(view.questionDeadline).toBe(now + 3000 + 10_000);
    expect(view.question?.type).toBe('choice');
    // The question itself carries no answer; stats.correct is the count of right answers.
    expect(JSON.stringify(view.question)).not.toMatch(
      /correct|answers|display/,
    );
    expect(JSON.stringify(view)).not.toMatch(/answers|bank|"display"/);
    const again = await service.start(1, 'daily');
    expect(again.sessionId).toBe(view.sessionId);
    expect(gamification.deductBanh).toHaveBeenCalledTimes(1);
  });

  it('a short balance takes nothing and frees the day dungeon again', async () => {
    gamification.deductBanh.mockResolvedValueOnce({
      success: false,
      newBalance: 5,
      message: 'Không đủ',
    });
    await expect(service.start(1, 'daily')).rejects.toThrow('Không đủ');
    await service.start(1, 'daily');
    expect(gamification.deductBanh).toHaveBeenCalledTimes(2);
  });

  it('the day dungeon is the same for everyone, whatever order the words come in', async () => {
    const a = await service.start(1, 'daily');
    findMany.mockResolvedValue([...entries].reverse());
    const b = await service.start(2, 'daily');
    expect(b.question).toEqual(a.question);
    expect(b.monster).toEqual(a.monster);
  });

  it('the day dungeon is once a day', async () => {
    const view = await service.start(1, 'daily');
    await service.finish(1, view.sessionId, true);
    await expect(service.start(1, 'daily')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.start(1, 'free')).resolves.toBeDefined();
  });

  it('only the owner can answer', async () => {
    const view = await service.start(1, 'free');
    await expect(
      service.answer(2, view.sessionId, { choice: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('right answers hit the monster; a wrong one or a timeout costs health', async () => {
    const view = await service.start(1, 'free');
    const id = view.sessionId;
    now += 1500;
    const hit = await service.answer(1, id, rightAnswer(id));
    expect(hit.last?.right).toBe(true);
    expect(hit.monster.hp).toBeLessThan(view.monster.hp);
    now += 1500;
    const miss = await service.answer(1, id, wrongAnswer(id));
    expect(miss.last?.right).toBe(false);
    expect(miss.hp).toBe(100 - monsterHit(1, false, {}));
    now += 1000;
    const timeout = await service.answer(1, id, {});
    expect(timeout.last?.timedOut).toBe(true);
  });

  it('a monster down offers toppings; only an offered one is taken, then the next floor', async () => {
    const view = await service.start(1, 'free');
    const id = view.sessionId;
    patch(id, (s) => {
      s.run.monster.hp = 1;
    });
    const down = await service.answer(1, id, rightAnswer(id));
    expect(down.phase).toBe('pick');
    expect(down.offers).toHaveLength(3);
    expect(down.question).toBeNull();
    const notOffered = ['garlic_butter', 'egg', 'cucumber', 'pate'].find(
      (t) => !down.offers.some((o) => o.id === t),
    )!;
    await expect(
      service.pick(1, id, notOffered as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    const next = await service.pick(1, id, down.offers[0].id);
    expect(next.floor).toBe(2);
    expect(next.phase).toBe('fight');
    expect(next.question).not.toBeNull();
  });

  it('a boss wants the word typed; beating it then falling pays the ticket back and 10, once', async () => {
    const view = await service.start(1, 'free');
    const id = view.sessionId;
    patch(id, (s) => {
      s.run.floor = 5;
      s.run.monster = { kind: 'sourdough_king', hp: 1, maxHp: 264, boss: true };
      s.question = null;
    });
    // A new question for the boss floor.
    patch(id, () => undefined);
    const s = stored(id);
    expect(s.run.monster.boss).toBe(true);
    // Ask again so the boss gets a typed question.
    const svc = service as unknown as {
      ask: (x: unknown) => void;
      store: (x: unknown) => Promise<void>;
    };
    const raw = JSON.parse(redis.store.get(`dungeon:run:${id}`)!);
    svc.ask(raw);
    await svc.store(raw);
    expect(stored(id).question!.q.type).toBe('typed');
    const boss = await service.answer(1, id, rightAnswer(id));
    expect(boss.stats.bossesDown).toBe(1);
    const next = await service.pick(1, id, boss.offers[0].id);
    patch(id, (x) => {
      x.run.hp = 1;
      x.run.shieldsLeft = 0;
    });
    const end = await service.answer(1, id, wrongAnswer(id));
    expect(next.floor).toBe(6);
    expect(end.result?.floor).toBe(6);
    expect(end.result?.net).toBe(10);
    expect(gamification.awardBanh).toHaveBeenCalledWith(
      1,
      20,
      'DUNGEON_RETURN',
      `dungeon:${id}:return`,
      expect.objectContaining({ isCapped: false }),
    );
    expect(gamification.awardBanh).toHaveBeenCalledWith(
      1,
      10,
      'DUNGEON_WIN',
      `dungeon:${id}:win`,
      expect.objectContaining({ isCapped: true }),
    );
    await service.finish(1, id, true);
    expect(gamification.awardBanh).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ userId: 1, type: 'DUNGEON_FREE', value: 6 }]);
    expect(end.result?.record).toBe(true);
  });

  it('leaving early keeps the ticket and records the floor', async () => {
    const view = await service.start(1, 'daily');
    const left = await service.finish(1, view.sessionId, true);
    expect(left.result?.forfeit).toBe(true);
    expect(left.result?.net).toBe(-20);
    expect(gamification.awardBanh).not.toHaveBeenCalled();
    expect(events).toEqual([{ userId: 1, type: 'DUNGEON_DAILY', value: 1 }]);
    expect(await service.current(1)).toBeNull();
  });

  it('a run left alone is settled by the sweep', async () => {
    const view = await service.start(1, 'free');
    expect(await service.sweepIdle(now + 60_000)).toBe(0);
    expect(await service.sweepIdle(now + 4 * 60_000)).toBe(1);
    expect(stored(view.sessionId)).toMatchObject({
      result: expect.objectContaining({ floor: 1 }),
    });
  });
});
