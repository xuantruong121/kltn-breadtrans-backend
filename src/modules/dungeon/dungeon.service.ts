import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import {
  ARENA_XP_REASON,
  buildArenaQuestions,
  vietnamDayStart,
  type ArenaWord,
} from '../events/arena-questions.logic';
import { loadAllReviewedWords, loadDeckWords } from '../events/arena-word-pool';
import {
  BANK_SIZE,
  DUNGEON_MODES,
  DUNGEON_TICKET,
  TOPPINGS,
  type ToppingEffect,
  toppingOffer,
  toppingsHeld,
  applyAnswer,
  choiceQuestion,
  dailySeed,
  dungeonPayout,
  dungeonXp,
  floorIntroMs,
  RUN_INTRO_MS,
  hashSeed,
  issueQuestion,
  newRun,
  pickTopping,
  questionTimeMs,
  seededRng,
  typedQuestion,
  type AnswerOutcome,
  type BankEntry,
  type DungeonMode,
  type DungeonQuestion,
  type PublicQuestion,
  type RunState,
  type ToppingId,
} from './dungeon.logic';

/** A run in Redis. Times are the server's epoch ms. */
type Session = {
  id: string;
  userId: number;
  mode: DungeonMode;
  /** The day of the day's dungeon ("2026-11-09"); null for a free run. */
  day: string | null;
  startedAt: number;
  run: RunState;
  bank: BankEntry[];
  question: {
    bankIndex: number;
    q: DungeonQuestion;
    view: PublicQuestion;
    issuedAt: number;
  } | null;
  last: AnswerOutcome | null;
  result: DungeonResult | null;
};

export type DungeonResult = {
  mode: DungeonMode;
  forfeit: boolean;
  floor: number;
  bossesDown: number;
  answered: number;
  correct: number;
  bestCombo: number;
  ticket: number;
  /** Net Bánh Mì: the ticket was paid at the start. */
  net: number;
  bonusCapped: number;
  xp: number;
  /** Deeper than the learner's best before, in this mode. */
  record: boolean;
  /** Place on today's board (day's dungeon only). */
  dailyRank: number | null;
};

export type DungeonView = {
  sessionId: string;
  mode: DungeonMode;
  serverNow: number;
  floor: number;
  hp: number;
  maxHp: number;
  combo: number;
  toppings: RunState['toppings'];
  monster: RunState['monster'];
  phase: RunState['phase'];
  offers: {
    id: ToppingId;
    name: string;
    /** What it does at the level it would reach, in plain words. */
    line: string;
    rarity: string;
    level: number;
    max: number;
    /** The number it moves, now and after taking it. */
    effect: ToppingEffect;
  }[];
  /** The toppings held, for the in-run list. */
  toppingsHeld: ReturnType<typeof toppingsHeld>;
  question: PublicQuestion | null;
  /** When the question runs out, by the server's clock, and its length. */
  /** When the question's clock starts and runs out, by the server's clock. */
  questionStartsAt: number | null;
  questionDeadline: number | null;
  questionMs: number | null;
  last: AnswerOutcome | null;
  stats: { answered: number; correct: number; bossesDown: number };
  result: DungeonResult | null;
};

const SESSION_TTL_S = 60 * 60;
const RESULT_TTL_S = 10 * 60;
/** A run untouched this long is settled where it stands (closed tab, lost connection). */
const IDLE_MS = 3 * 60_000;
const SWEEP_MS = 30_000;
const KEY = {
  session: (id: string) => `dungeon:run:${id}`,
  user: (userId: number) => `dungeon:user:${userId}`,
  lock: (id: string) => `dungeon:lock:${id}`,
  daily: (day: string, userId: number) => `dungeon:daily:${day}:${userId}`,
  open: 'dungeon:open',
};
const EVENT: Record<DungeonMode, string> = {
  daily: 'DUNGEON_DAILY',
  free: 'DUNGEON_FREE',
};
const MIN_BANK = 20;
/**
 * The page shows each answer's outcome (and the right answer after a miss)
 * before the next question; that question's clock starts only then, so the
 * learner never loses time to the animation. Answering earlier counts as 0 ms.
 */
const REVEAL_RIGHT_MS = 800;
const REVEAL_WRONG_MS = 1600;

/**
 * Hầm Bánh Mì, decided by the server: the answers and the clock stay here,
 * each learner has one run open, the day's dungeon once a day, and the
 * money moves only here.
 */
@Injectable()
export class DungeonService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DungeonService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
    private readonly gamification: GamificationService,
  ) {}

  onModuleInit() {
    void this.sweepIdle().catch((err) =>
      this.logger.error('[Dungeon] Boot sweep failed:', err),
    );
    this.sweepTimer = setInterval(() => {
      void this.sweepIdle().catch((err) =>
        this.logger.error('[Dungeon] Sweep failed:', err),
      );
    }, SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** Opens a run (paying the ticket), or returns the one still open. */
  async start(userId: number, mode: DungeonMode): Promise<DungeonView> {
    if (!DUNGEON_MODES.includes(mode))
      throw new BadRequestException('Chế độ không hợp lệ.');
    const open = await this.current(userId);
    if (open) return open;

    const now = new Date();
    const daily = mode === 'daily' ? dailySeed(now) : null;
    if (daily && (await this.playedToday(userId, daily.day, now)))
      throw new BadRequestException(
        'Hôm nay bạn đã vào Hầm hôm nay rồi. Mai quay lại nhé, hoặc thử Hầm tự do.',
      );
    const seed = daily?.seed ?? hashSeed(randomUUID());
    const bank = await this.buildBank(seed);
    if (bank.length < MIN_BANK)
      throw new BadRequestException(
        'Chưa đủ từ vựng để mở hầm. Vui lòng thử lại sau.',
      );

    const id = randomUUID();
    // The day's dungeon is taken before paying, so two quick starts cannot both pay.
    if (
      daily &&
      !(await this.redis.set(
        KEY.daily(daily.day, userId),
        id,
        'EX',
        2 * 86_400,
        'NX',
      ))
    )
      throw new BadRequestException('Hôm nay bạn đã vào Hầm hôm nay rồi.');
    const paid = await this.gamification.deductBanh(
      userId,
      DUNGEON_TICKET,
      'Vé Đấu trường · Hầm Bánh Mì',
      'DUNGEON_STAKE',
      `dungeon:${id}:stake`,
      { metadata: { sessionId: id, mode } },
    );
    if (!paid.success) {
      if (daily) await this.redis.del(KEY.daily(daily.day, userId));
      throw new BadRequestException(
        paid.message ?? `Bạn cần ${DUNGEON_TICKET} Bánh Mì để mua vé vào hầm.`,
      );
    }

    const session: Session = {
      id,
      userId,
      mode,
      day: daily?.day ?? null,
      startedAt: Date.now(),
      run: newRun(seed, mode),
      bank,
      question: null,
      last: null,
      result: null,
    };
    this.ask(session, RUN_INTRO_MS);
    try {
      await this.store(session);
      await this.redis.set(KEY.user(userId), id, 'EX', SESSION_TTL_S);
    } catch (err) {
      this.logger.error(`[Dungeon] ${id}: could not store the run`, err);
      await this.gamification.awardBanh(
        userId,
        DUNGEON_TICKET,
        'DUNGEON_RETURN',
        `dungeon:${id}:return`,
        {
          isCapped: false,
          metadata: { sessionId: id, reason: 'store_failed' },
        },
      );
      if (daily) await this.redis.del(KEY.daily(daily.day, userId));
      throw new BadRequestException(
        'Không mở được hầm, Bánh Mì đã được hoàn lại.',
      );
    }
    return this.view(session);
  }

  /** The learner's open run, if any (e.g. after a page reload). */
  async current(userId: number): Promise<DungeonView | null> {
    const id = await this.redis.get(KEY.user(userId));
    if (!id) return null;
    const session = await this.load(id);
    if (!session || session.result) {
      await this.redis.del(KEY.user(userId));
      return null;
    }
    return this.view(session);
  }

  /** One answer: an option, typed text, or nothing (the clock ran out). */
  async answer(
    userId: number,
    id: string,
    given: { choice?: number; text?: string },
  ): Promise<DungeonView> {
    return this.withLock(id, async () => {
      const session = await this.own(userId, id);
      if (session.result || session.run.phase !== 'fight' || !session.question)
        return this.view(session);
      const { q, bankIndex, issuedAt } = session.question;
      const value =
        q.type === 'choice'
          ? typeof given.choice === 'number'
            ? given.choice
            : null
          : typeof given.text === 'string' && given.text.trim()
            ? given.text
            : null;
      const step = applyAnswer(
        session.run,
        q,
        bankIndex,
        value,
        Math.max(0, Date.now() - issuedAt),
      );
      session.run = step.run;
      session.last = step.outcome;
      session.question = null;
      if (session.run.phase === 'over')
        return this.view(await this.settle(session, false));
      if (session.run.phase === 'fight')
        this.ask(
          session,
          step.outcome.right ? REVEAL_RIGHT_MS : REVEAL_WRONG_MS,
        );
      await this.store(session);
      return this.view(session);
    });
  }

  /** Takes an offered topping and goes down a floor. */
  async pick(
    userId: number,
    id: string,
    topping: ToppingId,
  ): Promise<DungeonView> {
    return this.withLock(id, async () => {
      const session = await this.own(userId, id);
      if (session.result || session.run.phase !== 'pick')
        return this.view(session);
      if (!session.run.offers.includes(topping))
        throw new BadRequestException('Topping này không có trong lựa chọn.');
      session.run = pickTopping(session.run, topping);
      session.last = null;
      this.ask(session, floorIntroMs(session.run.floor));
      await this.store(session);
      return this.view(session);
    });
  }

  /** Leaves the run (`forfeit`), or settles one already over. */
  async finish(
    userId: number,
    id: string,
    forfeit: boolean,
  ): Promise<DungeonView> {
    return this.withLock(id, async () => {
      const session = await this.own(userId, id);
      if (session.result) return this.view(session);
      if (forfeit || session.run.phase === 'over')
        return this.view(await this.settle(session, forfeit));
      return this.view(session);
    });
  }

  /** Today's board for the day's dungeon, and the learner's own records. */
  async board(userId: number) {
    const start = vietnamDayStart(new Date());
    const rows = await this.prisma.learnerEvent.findMany({
      where: {
        type: EVENT.daily,
        createdAt: { gte: start },
        user: { role: Role.STUDENT },
      },
      orderBy: [{ value: 'desc' }, { createdAt: 'asc' }],
      take: 200,
      select: {
        userId: true,
        value: true,
        createdAt: true,
        user: {
          select: { profile: { select: { fullName: true, avatar: true } } },
        },
      },
    });
    const seen = new Set<number>();
    const ranked = rows.filter(
      (r) => !seen.has(r.userId) && seen.add(r.userId),
    );
    const entries = ranked.slice(0, 20).map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      displayName: r.user.profile?.fullName || `Học viên #${r.userId}`,
      avatarUrl: r.user.profile?.avatar ?? null,
      floor: r.value,
    }));
    const mineIndex = ranked.findIndex((r) => r.userId === userId);
    const [bestFree, bestDaily] = await Promise.all([
      this.best(userId, 'free'),
      this.best(userId, 'daily'),
    ]);
    const day = dailySeed(new Date()).day;
    return {
      day,
      entries,
      players: ranked.length,
      me: {
        dailyFloor: mineIndex >= 0 ? ranked[mineIndex].value : null,
        dailyRank: mineIndex >= 0 ? mineIndex + 1 : null,
        playedToday: await this.playedToday(userId, day, new Date()),
        bestFree,
        bestDaily,
      },
    };
  }

  /** Settles runs left alone: closed tab, lost connection. */
  async sweepIdle(now = Date.now()): Promise<number> {
    const ids = await this.redis.zrangebyscore(KEY.open, 0, now);
    let settled = 0;
    for (const id of ids) {
      try {
        await this.withLock(id, async () => {
          const session = await this.load(id);
          if (!session || session.result) {
            await this.redis.zrem(KEY.open, id);
            return;
          }
          await this.settle(session, false);
          settled += 1;
        });
      } catch (err) {
        this.logger.error(`[Dungeon] ${id}: sweep failed`, err);
      }
    }
    return settled;
  }

  // ------------------------------------------------------------------ inside

  /**
   * The run's questions. Words are sorted by id first: the database returns
   * them in no set order, and the day's dungeon must ask everyone the same.
   */
  private async buildBank(seed: number): Promise<BankEntry[]> {
    const make = (pool: ArenaWord[]) => {
      const words = [...pool].sort((a, b) => a.id - b.id);
      const byId = new Map(words.map((w) => [w.id, w]));
      const rng = seededRng(seed);
      return buildArenaQuestions(words, BANK_SIZE, rng)
        .filter((q) => byId.has(q.id))
        .map((q) => ({
          choice: choiceQuestion(q, rng),
          typed: typedQuestion(byId.get(q.id)!, words),
        }));
    };
    let bank = make(await loadDeckWords(this.prisma));
    if (bank.length < MIN_BANK)
      bank = make(await loadAllReviewedWords(this.prisma));
    return bank;
  }

  /** Puts the next question out, timed from now. */
  private ask(session: Session, delayMs = 0) {
    const issued = issueQuestion(session.run, session.bank);
    session.run = issued.run;
    session.question = {
      bankIndex: issued.bankIndex,
      q: issued.question,
      view: issued.publicView,
      issuedAt: Date.now() + delayMs,
    };
  }

  private async playedToday(
    userId: number,
    day: string,
    now: Date,
  ): Promise<boolean> {
    if (await this.redis.exists(KEY.daily(day, userId))) return true;
    const row = await this.prisma.learnerEvent.findFirst({
      where: {
        userId,
        type: EVENT.daily,
        createdAt: { gte: vietnamDayStart(now) },
      },
      select: { id: true },
    });
    return row !== null;
  }

  private async best(
    userId: number,
    mode: DungeonMode,
  ): Promise<number | null> {
    const row = await this.prisma.learnerEvent.aggregate({
      where: { userId, type: EVENT[mode] },
      _max: { value: true },
    });
    return row._max.value ?? null;
  }

  /**
   * Pays out once: the ledger references make a second payment impossible
   * even if two settlements raced, and the lock keeps the XP to one.
   */
  private async settle(session: Session, forfeit: boolean): Promise<Session> {
    const run = session.run;
    const before = await this.best(session.userId, session.mode);
    const { returned, bonus } = dungeonPayout(run.bossesDown);
    if (returned > 0)
      await this.gamification.awardBanh(
        session.userId,
        returned,
        'DUNGEON_RETURN',
        `dungeon:${session.id}:return`,
        { isCapped: false, metadata: { sessionId: session.id } },
      );
    let bonusGranted = 0;
    if (bonus > 0) {
      const award = await this.gamification.awardBanh(
        session.userId,
        bonus,
        'DUNGEON_WIN',
        `dungeon:${session.id}:win`,
        { isCapped: true, metadata: { sessionId: session.id } },
      );
      bonusGranted = award.granted;
    }
    const xp = await this.awardXp(session.userId, run.correct);
    await this.prisma.learnerEvent.create({
      data: {
        userId: session.userId,
        type: EVENT[session.mode],
        value: run.floor,
      },
    });
    let dailyRank: number | null = null;
    if (session.mode === 'daily') {
      const deeper = await this.prisma.learnerEvent.findMany({
        where: {
          type: EVENT.daily,
          createdAt: { gte: vietnamDayStart(new Date()) },
          value: { gt: run.floor },
          userId: { not: session.userId },
        },
        distinct: ['userId'],
        select: { userId: true },
      });
      dailyRank = deeper.length + 1;
    }

    session.result = {
      mode: session.mode,
      forfeit,
      floor: run.floor,
      bossesDown: run.bossesDown,
      answered: run.answered,
      correct: run.correct,
      bestCombo: run.bestCombo,
      ticket: DUNGEON_TICKET,
      net: returned + bonusGranted - DUNGEON_TICKET,
      bonusCapped: bonus - bonusGranted,
      xp,
      record: before === null || run.floor > before,
      dailyRank,
    };
    session.question = null;
    await this.save(session, RESULT_TTL_S);
    await this.redis.zrem(KEY.open, session.id);
    await this.redis.del(KEY.user(session.userId));
    this.logger.log(
      `[Dungeon] ${session.id} user #${session.userId}: ${session.mode} floor ${run.floor}${forfeit ? ' (left)' : ''}, bosses ${run.bossesDown}, net ${session.result.net}`,
    );
    return session;
  }

  private async awardXp(userId: number, correct: number): Promise<number> {
    try {
      const today = await this.prisma.pointHistory.aggregate({
        where: {
          userId,
          reason: ARENA_XP_REASON,
          createdAt: { gte: vietnamDayStart(new Date()) },
        },
        _sum: { points: true },
      });
      const xp = dungeonXp(correct, today._sum.points ?? 0);
      if (xp > 0) await this.gamification.awardXp(userId, xp, ARENA_XP_REASON);
      return xp;
    } catch (err) {
      this.logger.error(`[Dungeon] XP for user ${userId} failed`, err);
      return 0;
    }
  }

  private view(session: Session): DungeonView {
    const run = session.run;
    const q = session.question;
    const ms = q
      ? questionTimeMs(run.floor, run.monster.boss, run.toppings)
      : null;
    return {
      sessionId: session.id,
      mode: session.mode,
      serverNow: Date.now(),
      floor: run.floor,
      hp: run.hp,
      maxHp: run.maxHp,
      combo: run.combo,
      toppings: run.toppings,
      monster: run.monster,
      phase: run.phase,
      offers: run.offers.map((id) => ({
        id,
        name: TOPPINGS[id].name,
        rarity: TOPPINGS[id].rarity,
        level: run.toppings[id] ?? 0,
        max: TOPPINGS[id].max,
        ...toppingOffer(run, id),
      })),
      toppingsHeld: toppingsHeld(run),
      question: q ? q.view : null,
      questionStartsAt: q ? q.issuedAt : null,
      questionDeadline: q && ms !== null ? q.issuedAt + ms : null,
      questionMs: ms,
      last: session.last,
      stats: {
        answered: run.answered,
        correct: run.correct,
        bossesDown: run.bossesDown,
      },
      result: session.result,
    };
  }

  /** Saves the run and moves its idle deadline. */
  private async store(session: Session) {
    await this.save(session, SESSION_TTL_S);
    await this.redis.zadd(KEY.open, Date.now() + IDLE_MS, session.id);
  }

  private async own(userId: number, id: string): Promise<Session> {
    const session = await this.load(id);
    if (!session)
      throw new NotFoundException('Lượt chơi không tồn tại hoặc đã hết hạn.');
    if (session.userId !== userId)
      throw new ForbiddenException('Đây không phải lượt chơi của bạn.');
    return session;
  }

  private async load(id: string): Promise<Session | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const raw = await this.redis.get(KEY.session(id));
    return raw ? (JSON.parse(raw) as Session) : null;
  }

  private async save(session: Session, ttl: number) {
    await this.redis.set(
      KEY.session(session.id),
      JSON.stringify(session),
      'EX',
      ttl,
    );
  }

  /** One request per run at a time, so two answers cannot overwrite each other. */
  private async withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    for (let i = 0; i < 40; i += 1) {
      if (await this.redis.set(KEY.lock(id), owner, 'PX', 5000, 'NX')) {
        try {
          return await work();
        } finally {
          if ((await this.redis.get(KEY.lock(id))) === owner)
            await this.redis.del(KEY.lock(id));
        }
      }
      await new Promise((ok) => setTimeout(ok, 25));
    }
    throw new BadRequestException('Lượt chơi đang bận, vui lòng thử lại.');
  }
}
