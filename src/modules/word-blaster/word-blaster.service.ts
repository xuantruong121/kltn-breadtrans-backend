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
import { PrismaService } from '../../prisma/prisma.service';
import { GamificationService } from '../gamification/gamification.service';
import {
  ARENA_XP_REASON,
  vietnamDayStart,
} from '../events/arena-questions.logic';
import { loadAllReviewedWords, loadDeckWords } from '../events/arena-word-pool';
import {
  BLASTER_BLOCKS,
  BLASTER_MODES,
  type BlasterMode,
  BLASTER_LIVES,
  BLASTER_STAKES,
  blasterDeadline,
  blasterPayout,
  blasterXp,
  buildBlasterRound,
  matchShot,
  publicBlocks,
  resolve,
  type BlasterBlock,
  type BlasterState,
  type PublicBlock,
} from './word-blaster.logic';

/** A game in Redis. `startedAt` is the server's epoch ms; every other time is relative to it. */
type Session = {
  id: string;
  userId: number;
  stake: number;
  /** One kind of block for the whole game; older games (before modes) have none. */
  mode?: BlasterMode;
  startedAt: number;
  deadline: number;
  blocks: BlasterBlock[];
  hits: Record<number, number>;
  result: BlasterResult | null;
};

export type BlasterResult = {
  outcome: 'win' | 'lose';
  forfeit: boolean;
  destroyed: number;
  landed: number;
  livesLeft: number;
  stake: number;
  /** Net change in Bánh Mì: the stake was taken at the start. */
  net: number;
  /** Part of the bonus withheld by the 150 a day cap. */
  bonusCapped: number;
  xp: number;
};

export type BlasterView = {
  sessionId: string;
  stake: number;
  mode: BlasterMode | null;
  serverNow: number;
  startedAt: number;
  lives: number;
  target: number;
  blocks: PublicBlock[];
  hits: Record<number, number>;
  state: Omit<BlasterState, 'endedAtMs'>;
  result: BlasterResult | null;
};

const SESSION_TTL_S = 30 * 60;
const RESULT_TTL_S = 10 * 60;
const SWEEP_MS = 30_000;
const KEY = {
  session: (id: string) => `blaster:session:${id}`,
  user: (userId: number) => `blaster:user:${userId}`,
  lock: (id: string) => `blaster:lock:${id}`,
  open: 'blaster:open',
};

/**
 * Bắn chữ rơi, decided by the server: the answers never leave it, the clock
 * is its own, each learner has one game open, and the money moves only here.
 */
@Injectable()
export class WordBlasterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WordBlasterService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
    private readonly gamification: GamificationService,
  ) {}

  onModuleInit() {
    // Games outlive a restart in Redis; any that ended while the server was
    // down are settled now, then every 30 s.
    void this.sweepExpired().catch((err) =>
      this.logger.error('[Blaster] Boot sweep failed:', err),
    );
    this.sweepTimer = setInterval(() => {
      void this.sweepExpired().catch((err) =>
        this.logger.error('[Blaster] Sweep failed:', err),
      );
    }, SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** Starts a game, or returns the one still open. */
  async start(
    userId: number,
    stake: number,
    mode: BlasterMode,
  ): Promise<BlasterView> {
    if (!(BLASTER_STAKES as readonly number[]).includes(stake))
      throw new BadRequestException('Mức cược không hợp lệ.');
    if (!BLASTER_MODES.includes(mode))
      throw new BadRequestException('Chế độ chơi không hợp lệ.');
    const open = await this.current(userId);
    if (open) return open;

    let words = await loadDeckWords(this.prisma);
    let blocks = buildBlasterRound(words, Math.random, mode);
    if (blocks.length < BLASTER_BLOCKS) {
      words = await loadAllReviewedWords(this.prisma);
      blocks = buildBlasterRound(words, Math.random, mode);
    }
    if (blocks.length < BLASTER_BLOCKS)
      throw new BadRequestException(
        'Chưa đủ từ vựng để mở ván. Vui lòng thử lại sau.',
      );

    const id = randomUUID();
    const paid = await this.gamification.deductBanh(
      userId,
      stake,
      'Cược Đấu Trường · Bắn chữ rơi',
      'BLASTER_STAKE',
      `blaster:${id}:stake`,
      { metadata: { sessionId: id } },
    );
    if (!paid.success)
      throw new BadRequestException(
        paid.message ?? `Bạn không đủ ${stake} Bánh Mì để cược.`,
      );

    const startedAt = Date.now();
    const session: Session = {
      id,
      userId,
      stake,
      mode,
      startedAt,
      deadline: startedAt + blasterDeadline(blocks),
      blocks,
      hits: {},
      result: null,
    };
    try {
      await this.save(session, SESSION_TTL_S);
      await this.redis.set(KEY.user(userId), id, 'EX', SESSION_TTL_S);
      await this.redis.zadd(KEY.open, session.deadline, id);
    } catch (err) {
      // The stake was taken but the game could not be kept: give it back.
      this.logger.error(`[Blaster] ${id}: could not store the game`, err);
      await this.gamification.awardBanh(
        userId,
        stake,
        'BLASTER_RETURN',
        `blaster:${id}:return`,
        {
          isCapped: false,
          metadata: { sessionId: id, reason: 'store_failed' },
        },
      );
      throw new BadRequestException(
        'Không mở được ván, Bánh Mì đã được hoàn lại.',
      );
    }
    return this.view(session);
  }

  /** The learner's open game, if any (e.g. after a page reload). */
  async current(userId: number): Promise<BlasterView | null> {
    const id = await this.redis.get(KEY.user(userId));
    if (!id) return null;
    const session = await this.load(id);
    if (!session || session.result) {
      await this.redis.del(KEY.user(userId));
      return null;
    }
    const state = resolve(
      session.blocks,
      session.hits,
      Date.now() - session.startedAt,
    );
    if (state.over) return this.view(await this.settle(session, false));
    return this.view(session);
  }

  /** A typed answer. The server's clock decides which block, if any, it breaks. */
  async shot(
    userId: number,
    id: string,
    text: string,
  ): Promise<BlasterView & { hitBlockId: number | null }> {
    return this.withLock(id, async () => {
      const session = await this.own(userId, id);
      if (session.result) return { ...this.view(session), hitBlockId: null };
      const now = Date.now() - session.startedAt;
      const hitBlockId = matchShot(session.blocks, session.hits, text, now);
      if (hitBlockId !== null) {
        session.hits[hitBlockId] = now;
        await this.save(session, SESSION_TTL_S);
      }
      const state = resolve(session.blocks, session.hits, now);
      const final = state.over ? await this.settle(session, false) : session;
      return { ...this.view(final), hitBlockId };
    });
  }

  /**
   * The page saw the game end (a block landed with no shot to send), or the
   * learner left: `forfeit` loses at once. Otherwise the server checks that
   * the game really is over.
   */
  async finish(
    userId: number,
    id: string,
    forfeit: boolean,
  ): Promise<BlasterView> {
    return this.withLock(id, async () => {
      const session = await this.own(userId, id);
      if (session.result) return this.view(session);
      if (forfeit) return this.view(await this.settle(session, true));
      const state = resolve(
        session.blocks,
        session.hits,
        Date.now() - session.startedAt,
      );
      if (!state.over) return this.view(session);
      return this.view(await this.settle(session, false));
    });
  }

  /** Settles games whose every block has landed (closed tab, lost connection). */
  async sweepExpired(now = Date.now()): Promise<number> {
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
        this.logger.error(`[Blaster] ${id}: sweep failed`, err);
      }
    }
    return settled;
  }

  /**
   * Pays out once. The ledger references make a second payment impossible
   * even if two settlements raced; the lock keeps the XP to one as well.
   */
  private async settle(session: Session, forfeit: boolean): Promise<Session> {
    const now = Math.min(
      Date.now() - session.startedAt,
      session.deadline - session.startedAt,
    );
    const state = resolve(
      session.blocks,
      session.hits,
      forfeit ? now : Math.max(now, session.deadline - session.startedAt),
    );
    const outcome: 'win' | 'lose' =
      !forfeit && state.outcome === 'win' ? 'win' : 'lose';
    const { returned, bonus } = blasterPayout(session.stake, outcome);
    let bonusGranted = 0;
    if (returned > 0)
      await this.gamification.awardBanh(
        session.userId,
        returned,
        'BLASTER_RETURN',
        `blaster:${session.id}:return`,
        { isCapped: false, metadata: { sessionId: session.id } },
      );
    if (bonus > 0) {
      const award = await this.gamification.awardBanh(
        session.userId,
        bonus,
        'BLASTER_WIN',
        `blaster:${session.id}:win`,
        { isCapped: true, metadata: { sessionId: session.id } },
      );
      bonusGranted = award.granted;
    }
    const xp = await this.awardXp(session.userId, state.destroyed);

    session.result = {
      outcome,
      forfeit,
      destroyed: state.destroyed,
      landed: state.landed,
      livesLeft: outcome === 'win' ? state.livesLeft : 0,
      stake: session.stake,
      net: outcome === 'win' ? bonusGranted : -session.stake,
      bonusCapped: bonus - bonusGranted,
      xp,
    };
    await this.save(session, RESULT_TTL_S);
    await this.redis.zrem(KEY.open, session.id);
    await this.redis.del(KEY.user(session.userId));
    this.logger.log(
      `[Blaster] ${session.id} user #${session.userId}: ${outcome}${forfeit ? ' (left)' : ''}, ${state.destroyed}/${session.blocks.length}, net ${session.result.net}`,
    );
    return session;
  }

  private async awardXp(userId: number, destroyed: number): Promise<number> {
    try {
      const today = await this.prisma.pointHistory.aggregate({
        where: {
          userId,
          reason: ARENA_XP_REASON,
          createdAt: { gte: vietnamDayStart(new Date()) },
        },
        _sum: { points: true },
      });
      const xp = blasterXp(destroyed, today._sum.points ?? 0);
      if (xp > 0) await this.gamification.awardXp(userId, xp, ARENA_XP_REASON);
      return xp;
    } catch (err) {
      this.logger.error(`[Blaster] XP for user ${userId} failed`, err);
      return 0;
    }
  }

  private view(session: Session): BlasterView {
    const now = Date.now();
    const { endedAtMs: _ended, ...state } = resolve(
      session.blocks,
      session.hits,
      now - session.startedAt,
    );
    void _ended;
    return {
      sessionId: session.id,
      stake: session.stake,
      mode: session.mode ?? null,
      serverNow: now,
      startedAt: session.startedAt,
      lives: BLASTER_LIVES,
      target: session.blocks.length,
      blocks: publicBlocks(session.blocks),
      hits: session.hits,
      state,
      result: session.result,
    };
  }

  private async own(userId: number, id: string): Promise<Session> {
    const session = await this.load(id);
    if (!session)
      throw new NotFoundException('Ván chơi không tồn tại hoặc đã hết hạn.');
    if (session.userId !== userId)
      throw new ForbiddenException('Đây không phải ván của bạn.');
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

  /** One request per game at a time, so two shots cannot overwrite each other. */
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
    throw new BadRequestException('Ván đang bận, vui lòng thử lại.');
  }
}
