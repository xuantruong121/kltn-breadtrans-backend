import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from './events.gateway';

interface ServerQuestion {
  id: number;
  prompt: string;
  ipa?: string;
  options: string[];
  correctAnswer: string;
  explanation?: string;
}

interface MatchPlayer {
  userId: number;
  socketId: string;
  userName: string;
  avatar?: string;
  score: number;
  isDisconnected: boolean;
  disconnectedAt?: number;
  answers: Record<
    number,
    {
      selectedOption: string;
      isCorrect: boolean;
      addedPoints: number;
      answeredAt: number;
    }
  >;
}

interface MatchState {
  matchId: string;
  stake: number;
  gameId: string;
  status: 'in_progress' | 'settled' | 'forfeited';
  currentRound: number;
  totalRounds: number;
  roundStartTime: number;
  roundDuration: number;
  p1: MatchPlayer;
  p2: MatchPlayer;
  questions: ServerQuestion[];
  isSettled: boolean;
  createdAt: number;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/arena',
})
export class ArenaGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ArenaGateway.name);
  private roundTimers: Map<string, NodeJS.Timeout> = new Map();
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
    private readonly eventsGateway: EventsGateway,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`[Arena] Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`[Arena] Client disconnected: ${client.id}`);
    const socketId = client.id;

    // 1. Remove from all possible waiting queues in Redis
    try {
      const keys = await this.redis.keys('arena:queue:*');
      for (const key of keys) {
        const items = await this.redis.lrange(key, 0, -1);
        for (const item of items) {
          try {
            const player = JSON.parse(item);
            if (player.socketId === socketId) {
              await this.redis.lrem(key, 0, item);
              await this.redis.srem(
                'arena:queued_users',
                String(player.userId),
              );
              await this.redis.del(`arena:lock:user:${player.userId}`);
              await this.redis.del(`arena:user_queued:${player.userId}`);
              this.logger.log(
                `[Arena] Removed queued player #${player.userId} from ${key}`,
              );
            }
          } catch {
            // ignore JSON parse error
          }
        }
      }
    } catch (err) {
      this.logger.error(
        '[Arena] Error cleaning up disconnected queue item:',
        err,
      );
    }

    // 2. Check if the socket was in an active match
    try {
      const activeMatchKeys = await this.redis.keys('arena:match:*');
      for (const mKey of activeMatchKeys) {
        const raw = await this.redis.get(mKey);
        if (!raw) continue;
        const match: MatchState = JSON.parse(raw);
        if (match.isSettled) continue;

        let disconnectedPlayerRole: 'p1' | 'p2' | null = null;
        if (match.p1.socketId === socketId && !match.p1.isDisconnected) {
          disconnectedPlayerRole = 'p1';
        } else if (match.p2.socketId === socketId && !match.p2.isDisconnected) {
          disconnectedPlayerRole = 'p2';
        }

        if (disconnectedPlayerRole) {
          const disconnectedPlayer = match[disconnectedPlayerRole];

          disconnectedPlayer.isDisconnected = true;
          disconnectedPlayer.disconnectedAt = Date.now();
          await this.redis.set(mKey, JSON.stringify(match), 'EX', 900);

          this.logger.warn(
            `[Arena] Player #${disconnectedPlayer.userId} (${disconnectedPlayer.userName}) disconnected from match ${match.matchId}. Grace period: 15s.`,
          );

          // Notify opponent
          this.server.to(match.matchId).emit('arena:opponent_disconnected', {
            disconnectedUserId: disconnectedPlayer.userId,
            disconnectedUserName: disconnectedPlayer.userName,
            gracePeriodSeconds: 15,
            message: `Đối thủ (${disconnectedPlayer.userName}) đang mất kết nối. Đang chờ kết nối lại (15s)...`,
          });

          // Set 15s Disconnect Forfeit Timer
          const timerKey = `${match.matchId}_${disconnectedPlayer.userId}`;
          if (this.disconnectTimers.has(timerKey)) {
            clearTimeout(this.disconnectTimers.get(timerKey));
          }

          const timeout = setTimeout(() => {
            this.disconnectTimers.delete(timerKey);
            void this.handleForfeit(match.matchId, disconnectedPlayer.userId);
          }, 15000);

          this.disconnectTimers.set(timerKey, timeout);
        }
      }
    } catch (err) {
      this.logger.error('[Arena] Error handling disconnect match lookup:', err);
    }
  }

  // ==========================================
  // MATCHMAKING LOGIC (REDIS QUEUE)
  // ==========================================

  @SubscribeMessage('join_queue')
  async handleJoinQueue(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      userId: number;
      userName?: string;
      stake?: number;
      gameId?: string;
    },
  ) {
    const stake = payload.stake || 20;
    const userId = payload.userId;
    const userName = payload.userName || `Player ${userId}`;
    const gameId = payload.gameId || 'vocab-duel';
    const queueKey = `arena:queue:${stake}:${gameId}`;
    const queuedSetKey = 'arena:queued_users';

    // 0. Atomic Deduplication: Kiểm tra user có đang trong hàng đợi hay không qua Redis Set O(1)
    const addedToQueueSet = await this.redis.sadd(queuedSetKey, String(userId));
    if (addedToQueueSet === 0) {
      client.emit('arena:error', {
        message: 'Bạn đang trong hàng đợi tìm trận hoặc đã vào trận đấu!',
      });
      return;
    }

    // 0b. Chống double-click tức thời bằng atomic lock NX PX 5000
    const userLockKey = `arena:lock:user:${userId}`;
    const locked = await this.redis.set(userLockKey, '1', 'PX', 5000, 'NX');
    if (!locked) {
      client.emit('arena:error', {
        message: 'Thao tác quá nhanh, vui lòng đợi một chút!',
      });
      return;
    }

    // 1. Verify user exists and has enough Bánh Mì
    const userStats = await this.prisma.userStats.findUnique({
      where: { userId },
      include: { user: { include: { profile: true } } },
    });

    if (!userStats || userStats.totalBanhRan < stake) {
      await this.redis.srem(queuedSetKey, String(userId));
      await this.redis.del(userLockKey);
      client.emit('arena:error', {
        message: `Bạn không đủ ${stake} Bánh Mì để tham gia mức cược này!`,
      });
      return;
    }

    const avatar = userStats.user?.profile?.avatar || '';

    // 2. Check if user is already in an active unsettled match
    const existingMatchId = await this.redis.get(`arena:user_match:${userId}`);
    if (existingMatchId) {
      const rawMatch = await this.redis.get(`arena:match:${existingMatchId}`);
      if (rawMatch) {
        const match: MatchState = JSON.parse(rawMatch);
        if (!match.isSettled) {
          // Allow client to resume match
          await this.redis.srem(queuedSetKey, String(userId));
          await this.redis.del(userLockKey);
          await this.reconnectPlayerToMatch(client, match, userId);
          return;
        }
      }
    }

    // 3. Remove user from any existing queue to prevent duplicate entries
    await this.removeUserFromQueues(userId);
    // Tái kích hoạt lại vào queuedSetKey vì removeUserFromQueues đã srem
    await this.redis.sadd(queuedSetKey, String(userId));

    // 4. Push to Redis queue
    const playerData = {
      socketId: client.id,
      userId,
      userName,
      avatar,
      stake,
      gameId,
      queuedAt: Date.now(),
    };

    await this.redis.rpush(queueKey, JSON.stringify(playerData));
    await this.redis.set(`arena:user_queued:${userId}`, client.id, 'EX', 120);

    const queueLength = await this.redis.llen(queueKey);
    this.logger.log(
      `[Arena] User #${userId} joined queue ${queueKey}. Current queue length: ${queueLength}`,
    );

    // 5. If queue has >= 2 players, attempt matchmaking
    if (queueLength >= 2) {
      await this.tryMatchPlayers(queueKey, stake, gameId);
    } else {
      client.emit('arena:waiting', {
        message: 'Đang tìm kiếm đối thủ xứng tầm...',
        stake,
        queueSize: queueLength,
      });
    }
  }

  @SubscribeMessage('cancel_queue')
  async handleCancelQueue(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload?: { userId?: number },
  ) {
    if (payload?.userId) {
      await this.removeUserFromQueues(payload.userId);
    }
    client.emit('arena:cancelled', { message: 'Đã hủy tìm trận đấu.' });
  }

  private async removeUserFromQueues(userId: number) {
    try {
      await this.redis.srem('arena:queued_users', String(userId));
      await this.redis.del(`arena:lock:user:${userId}`);
      await this.redis.del(`arena:user_queued:${userId}`);
      const keys = await this.redis.keys('arena:queue:*');
      for (const key of keys) {
        const items = await this.redis.lrange(key, 0, -1);
        for (const item of items) {
          try {
            const player = JSON.parse(item);
            if (player.userId === userId) {
              await this.redis.lrem(key, 0, item);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      this.logger.error('[Arena] Error in removeUserFromQueues:', err);
    }
  }

  private async tryMatchPlayers(
    queueKey: string,
    stake: number,
    gameId: string,
  ) {
    // 0. Matchmaking Mutex Lock: Chỉ 1 tiến trình xử lý ghép cặp trên queue này tại một thời điểm
    const matchMutexKey = `arena:lock:matcher:${queueKey}`;
    const acquired = await this.redis.set(matchMutexKey, '1', 'PX', 3000, 'NX');
    if (!acquired) {
      return; // Một tiến trình khác đang xử lý ghép cặp cho queue này
    }

    try {
      const p1Raw = await this.redis.lpop(queueKey);
      const p2Raw = await this.redis.lpop(queueKey);

      if (!p1Raw || !p2Raw) {
        if (p1Raw) await this.redis.lpush(queueKey, p1Raw);
        return;
      }

      const p1 = JSON.parse(p1Raw);
      const p2 = JSON.parse(p2Raw);

      // Sanity check: cùng 1 user không tự đấu với chính mình
      if (p1.userId === p2.userId) {
        await this.redis.lpush(queueKey, p1Raw);
        await this.redis.srem('arena:queued_users', String(p1.userId));
        return;
      }

      // Check both sockets are alive
      const s1 = this.server.sockets.sockets.get(p1.socketId);
      const s2 = this.server.sockets.sockets.get(p2.socketId);

      if (!s1 || !s2) {
        if (s1) {
          await this.redis.lpush(queueKey, p1Raw);
        } else {
          await this.redis.srem('arena:queued_users', String(p1.userId));
        }
        if (s2) {
          await this.redis.lpush(queueKey, p2Raw);
        } else {
          await this.redis.srem('arena:queued_users', String(p2.userId));
        }
        return;
      }

      // Generate Match
      const matchId = `match_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const questions = await this.fetchArenaQuestions(5);

      // Escrow stakes nguyên tử qua Prisma Transaction
      let escrowError: string | null = null;
      try {
        await this.prisma.$transaction(async (tx) => {
          const p1Deduct = await tx.userStats.updateMany({
            where: { userId: p1.userId, totalBanhRan: { gte: stake } },
            data: { totalBanhRan: { decrement: stake } },
          });
          const p2Deduct = await tx.userStats.updateMany({
            where: { userId: p2.userId, totalBanhRan: { gte: stake } },
            data: { totalBanhRan: { decrement: stake } },
          });

          if (p1Deduct.count === 0) {
            throw new Error('P1_INSUFFICIENT');
          }
          if (p2Deduct.count === 0) {
            throw new Error('P2_INSUFFICIENT');
          }

          // Log escrow currency transactions
          await tx.currencyTransaction.createMany({
            data: [
              {
                studentId: p1.userId,
                studentName: p1.userName,
                userId: p1.userId,
                userName: p1.userName,
                userRole: 'STUDENT',
                amount: -stake,
                reason: `Cược Đấu Trường 1v1 (${matchId})`,
                type: 'subtract',
              },
              {
                studentId: p2.userId,
                studentName: p2.userName,
                userId: p2.userId,
                userName: p2.userName,
                userRole: 'STUDENT',
                amount: -stake,
                reason: `Cược Đấu Trường 1v1 (${matchId})`,
                type: 'subtract',
              },
            ],
          });
        });
      } catch (err: any) {
        escrowError = err?.message || 'ESCROW_ERROR';
        this.logger.warn(
          `[Arena] Escrow failed for match ${matchId}: ${escrowError}`,
        );
      }

      if (escrowError) {
        if (escrowError === 'P1_INSUFFICIENT') {
          s1?.emit('arena:error', {
            message: `Bạn không còn đủ ${stake} Bánh Mì để tham gia trận đấu!`,
          });
          await this.redis.srem('arena:queued_users', String(p1.userId));
          // Đưa P2 lại vào hàng đợi để chờ đối thủ khác
          await this.redis.lpush(queueKey, p2Raw);
        } else if (escrowError === 'P2_INSUFFICIENT') {
          s2?.emit('arena:error', {
            message: `Bạn không còn đủ ${stake} Bánh Mì để tham gia trận đấu!`,
          });
          await this.redis.srem('arena:queued_users', String(p2.userId));
          // Đưa P1 lại vào hàng đợi để chờ đối thủ khác
          await this.redis.lpush(queueKey, p1Raw);
        } else {
          // Lỗi hệ thống khác, đưa cả 2 trở lại hàng đợi
          await this.redis.lpush(queueKey, p2Raw, p1Raw);
        }
        return;
      }

      // Khi đã ghép và trừ cược thành công -> xóa khỏi Set queued_users
      await this.redis.srem(
        'arena:queued_users',
        String(p1.userId),
        String(p2.userId),
      );
      await this.redis.del(`arena:lock:user:${p1.userId}`);
      await this.redis.del(`arena:lock:user:${p2.userId}`);

      const matchState: MatchState = {
        matchId,
        stake,
        gameId,
        status: 'in_progress',
        currentRound: 0,
        totalRounds: questions.length,
        roundStartTime: Date.now(),
        roundDuration: 15,
        p1: {
          userId: p1.userId,
          socketId: p1.socketId,
          userName: p1.userName,
          avatar: p1.avatar,
          score: 0,
          isDisconnected: false,
          answers: {},
        },
        p2: {
          userId: p2.userId,
          socketId: p2.socketId,
          userName: p2.userName,
          avatar: p2.avatar,
          score: 0,
          isDisconnected: false,
          answers: {},
        },
        questions,
        isSettled: false,
        createdAt: Date.now(),
      };

      // Save match to Redis with 15-minute TTL
      await this.redis.set(
        `arena:match:${matchId}`,
        JSON.stringify(matchState),
        'EX',
        900,
      );
      await this.redis.set(`arena:user_match:${p1.userId}`, matchId, 'EX', 900);
      await this.redis.set(`arena:user_match:${p2.userId}`, matchId, 'EX', 900);

      // Join socket room
      await s1.join(matchId);
      await s2.join(matchId);

      this.logger.log(
        `[Arena] Match created: ${matchId} | P1: ${p1.userName} (#${p1.userId}) vs P2: ${p2.userName} (#${p2.userId})`,
      );

      // Sanitized questions for client (correct answers hidden!)
      const clientQuestions = questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        ipa: q.ipa || '',
        options: q.options,
      }));

      // Emit match found
      this.server.to(matchId).emit('arena:match_found', {
        roomId: matchId,
        matchId,
        stake,
        player1: {
          userId: p1.userId,
          userName: p1.userName,
          avatar: p1.avatar,
        },
        player2: {
          userId: p2.userId,
          userName: p2.userName,
          avatar: p2.avatar,
        },
        questions: clientQuestions,
        totalRounds: questions.length,
      });

      // Start Round 0 after 2.5s countdown
      setTimeout(() => {
        void this.startRound(matchId, 0);
      }, 2500);
    } catch (err) {
      this.logger.error('[Arena] Error in tryMatchPlayers:', err);
    } finally {
      await this.redis.del(matchMutexKey);
    }
  }

  // ==========================================
  // SYNCHRONIZED ROUND & TIMER LOGIC
  // ==========================================

  private async startRound(matchId: string, roundIndex: number) {
    try {
      const rawMatch = await this.redis.get(`arena:match:${matchId}`);
      if (!rawMatch) return;

      const match: MatchState = JSON.parse(rawMatch);
      if (match.isSettled) return;

      if (roundIndex >= match.totalRounds) {
        await this.settleBattle(matchId);
        return;
      }

      match.currentRound = roundIndex;
      match.roundStartTime = Date.now();
      match.roundDuration = 15;
      await this.redis.set(
        `arena:match:${matchId}`,
        JSON.stringify(match),
        'EX',
        900,
      );

      const q = match.questions[roundIndex];

      this.logger.log(
        `[Arena] [${matchId}] Round ${roundIndex + 1}/${match.totalRounds} started.`,
      );

      this.server.to(matchId).emit('arena:round_start', {
        matchId,
        roundIndex,
        totalRounds: match.totalRounds,
        duration: 15,
        serverStartTime: match.roundStartTime,
        question: {
          id: q.id,
          prompt: q.prompt,
          ipa: q.ipa || '',
          options: q.options,
        },
      });

      // Set server round timeout (15.5s to allow for small network lag)
      if (this.roundTimers.has(matchId)) {
        clearTimeout(this.roundTimers.get(matchId));
      }

      const timeout = setTimeout(() => {
        this.roundTimers.delete(matchId);
        void this.endRound(matchId, roundIndex);
      }, 15500);

      this.roundTimers.set(matchId, timeout);
    } catch (err) {
      this.logger.error(`[Arena] Error in startRound for ${matchId}:`, err);
    }
  }

  @SubscribeMessage('submit_answer')
  async handleSubmitAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      roomId?: string;
      matchId?: string;
      userId: number;
      questionIndex?: number;
      roundIndex?: number;
      selectedOption: string;
      answerTimeMs?: number;
    },
  ) {
    const matchId = payload.matchId || payload.roomId;
    if (!matchId) return;

    try {
      const rawMatch = await this.redis.get(`arena:match:${matchId}`);
      if (!rawMatch) return;

      const match: MatchState = JSON.parse(rawMatch);
      if (match.isSettled) return;

      const roundIndex =
        payload.roundIndex !== undefined
          ? payload.roundIndex
          : payload.questionIndex || 0;
      if (roundIndex !== match.currentRound) {
        return; // Stale round answer, ignore
      }

      const isP1 = match.p1.userId === payload.userId;
      const player = isP1 ? match.p1 : match.p2;

      // Prevent answering twice in same round
      if (player.answers[roundIndex]) return;

      const currentQ = match.questions[roundIndex];
      const isCorrect = payload.selectedOption === currentQ.correctAnswer;
      const elapsedMs = Math.max(0, Date.now() - match.roundStartTime);

      // Score formula: Base 100 + Speed Bonus (up to 50 for <3s)
      let addedPoints = 0;
      if (isCorrect) {
        const speedBonus = Math.max(0, Math.floor((15000 - elapsedMs) / 300));
        addedPoints = 100 + speedBonus;
        player.score += addedPoints;
      }

      player.answers[roundIndex] = {
        selectedOption: payload.selectedOption,
        isCorrect,
        addedPoints,
        answeredAt: Date.now(),
      };

      await this.redis.set(
        `arena:match:${matchId}`,
        JSON.stringify(match),
        'EX',
        900,
      );

      this.logger.log(
        `[Arena] [${matchId}] Player #${player.userId} answered Q${roundIndex + 1}: ${isCorrect ? 'CORRECT' : 'WRONG'} (+${addedPoints} pts, Total: ${player.score})`,
      );

      // Broadcast progress
      this.server.to(matchId).emit('arena:progress_update', {
        p1: {
          userId: match.p1.userId,
          score: match.p1.score,
          answered: Object.keys(match.p1.answers).length,
          hasAnsweredCurrentRound: !!match.p1.answers[roundIndex],
        },
        p2: {
          userId: match.p2.userId,
          score: match.p2.score,
          answered: Object.keys(match.p2.answers).length,
          hasAnsweredCurrentRound: !!match.p2.answers[roundIndex],
        },
      });

      // If both players have answered this round, end the round immediately!
      if (match.p1.answers[roundIndex] && match.p2.answers[roundIndex]) {
        if (this.roundTimers.has(matchId)) {
          clearTimeout(this.roundTimers.get(matchId));
          this.roundTimers.delete(matchId);
        }
        await this.endRound(matchId, roundIndex);
      }
    } catch (err) {
      this.logger.error(
        `[Arena] Error in handleSubmitAnswer for ${matchId}:`,
        err,
      );
    }
  }

  private async endRound(matchId: string, roundIndex: number) {
    try {
      const rawMatch = await this.redis.get(`arena:match:${matchId}`);
      if (!rawMatch) return;

      const match: MatchState = JSON.parse(rawMatch);
      if (match.isSettled) return;

      const q = match.questions[roundIndex];
      const p1Ans = match.p1.answers[roundIndex];
      const p2Ans = match.p2.answers[roundIndex];

      this.logger.log(
        `[Arena] [${matchId}] Round ${roundIndex + 1} ended. Correct: "${q.correctAnswer}" | P1: ${match.p1.score} vs P2: ${match.p2.score}`,
      );

      // Emit round result to reveal answers and explanations to both players
      this.server.to(matchId).emit('arena:round_result', {
        roundIndex,
        correctAnswer: q.correctAnswer,
        explanation:
          q.explanation || `Đáp án chính xác là "${q.correctAnswer}".`,
        p1: {
          userId: match.p1.userId,
          selectedOption: p1Ans?.selectedOption || null,
          isCorrect: p1Ans?.isCorrect || false,
          addedPoints: p1Ans?.addedPoints || 0,
          score: match.p1.score,
        },
        p2: {
          userId: match.p2.userId,
          selectedOption: p2Ans?.selectedOption || null,
          isCorrect: p2Ans?.isCorrect || false,
          addedPoints: p2Ans?.addedPoints || 0,
          score: match.p2.score,
        },
      });

      // Schedule next round or settlement after 2.5 seconds
      setTimeout(() => {
        void (roundIndex + 1 < match.totalRounds
          ? this.startRound(matchId, roundIndex + 1)
          : this.settleBattle(matchId));
      }, 2500);
    } catch (err) {
      this.logger.error(`[Arena] Error in endRound for ${matchId}:`, err);
    }
  }

  // ==========================================
  // RECONNECTION & FORFEIT HANDLING (15s GRACE)
  // ==========================================

  @SubscribeMessage('reconnect_match')
  async handleReconnectMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchId: string; userId: number },
  ) {
    try {
      const rawMatch = await this.redis.get(`arena:match:${payload.matchId}`);
      if (!rawMatch) {
        client.emit('arena:error', {
          message: 'Trận đấu không tồn tại hoặc đã kết thúc.',
        });
        return;
      }

      const match: MatchState = JSON.parse(rawMatch);
      if (match.isSettled) {
        client.emit('arena:error', { message: 'Trận đấu đã kết thúc.' });
        return;
      }

      await this.reconnectPlayerToMatch(client, match, payload.userId);
    } catch (err) {
      this.logger.error('[Arena] Error in handleReconnectMatch:', err);
    }
  }

  private async reconnectPlayerToMatch(
    client: Socket,
    match: MatchState,
    userId: number,
  ) {
    const isP1 = match.p1.userId === userId;
    const isP2 = match.p2.userId === userId;
    if (!isP1 && !isP2) return;

    const player = isP1 ? match.p1 : match.p2;
    player.socketId = client.id;
    player.isDisconnected = false;
    delete player.disconnectedAt;

    // Clear disconnect timer if active
    const timerKey = `${match.matchId}_${userId}`;
    if (this.disconnectTimers.has(timerKey)) {
      clearTimeout(this.disconnectTimers.get(timerKey));
      this.disconnectTimers.delete(timerKey);
    }

    await this.redis.set(
      `arena:match:${match.matchId}`,
      JSON.stringify(match),
      'EX',
      900,
    );
    await client.join(match.matchId);

    this.logger.log(
      `[Arena] Player #${userId} successfully reconnected to match ${match.matchId}`,
    );

    // Notify opponent
    this.server.to(match.matchId).emit('arena:opponent_reconnected', {
      reconnectedUserId: userId,
      message: `Đối thủ (${player.userName}) đã kết nối lại! Trận đấu tiếp tục.`,
    });

    // Send state restoration to returning player
    const clientQuestions = match.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      ipa: q.ipa || '',
      options: q.options,
    }));

    const remainingMs = Math.max(
      0,
      match.roundDuration * 1000 - (Date.now() - match.roundStartTime),
    );

    client.emit('arena:match_state_restored', {
      matchId: match.matchId,
      stake: match.stake,
      currentRound: match.currentRound,
      totalRounds: match.totalRounds,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      serverStartTime: match.roundStartTime,
      player1: {
        userId: match.p1.userId,
        userName: match.p1.userName,
        avatar: match.p1.avatar,
      },
      player2: {
        userId: match.p2.userId,
        userName: match.p2.userName,
        avatar: match.p2.avatar,
      },
      questions: clientQuestions,
      p1: {
        score: match.p1.score,
        answered: Object.keys(match.p1.answers).length,
      },
      p2: {
        score: match.p2.score,
        answered: Object.keys(match.p2.answers).length,
      },
    });
  }

  private async handleForfeit(matchId: string, forfeitedUserId: number) {
    try {
      const rawMatch = await this.redis.get(`arena:match:${matchId}`);
      if (!rawMatch) return;

      const match: MatchState = JSON.parse(rawMatch);
      if (match.isSettled) return;

      const winnerRole = match.p1.userId === forfeitedUserId ? 'p2' : 'p1';

      this.logger.warn(
        `[Arena] [${matchId}] Player #${forfeitedUserId} forfeited due to 15s disconnect timeout.`,
      );

      await this.finalizeMatch(match, winnerRole, true);
    } catch (err) {
      this.logger.error(`[Arena] Error in handleForfeit for ${matchId}:`, err);
    }
  }

  // ==========================================
  // BATTLE SETTLEMENT & REWARDS
  // ==========================================

  private async settleBattle(matchId: string) {
    try {
      const rawMatch = await this.redis.get(`arena:match:${matchId}`);
      if (!rawMatch) return;

      const match: MatchState = JSON.parse(rawMatch);
      if (match.isSettled) return;

      let winnerRole: 'p1' | 'p2' | 'draw' = 'draw';
      if (match.p1.score > match.p2.score) {
        winnerRole = 'p1';
      } else if (match.p2.score > match.p1.score) {
        winnerRole = 'p2';
      }

      await this.finalizeMatch(match, winnerRole, false);
    } catch (err) {
      this.logger.error(`[Arena] Error in settleBattle for ${matchId}:`, err);
    }
  }

  private async finalizeMatch(
    match: MatchState,
    winnerRole: 'p1' | 'p2' | 'draw',
    isForfeit: boolean,
  ) {
    match.isSettled = true;
    match.status = isForfeit ? 'forfeited' : 'settled';

    const totalReward = match.stake * 2;
    let winnerUserId: number | null = null;

    if (winnerRole === 'p1' || winnerRole === 'p2') {
      const winner = match[winnerRole];
      winnerUserId = winner.userId;

      // 1. Award Bánh Mì to Winner
      const updatedStats = await this.prisma.userStats.update({
        where: { userId: winner.userId },
        data: { totalBanhRan: { increment: totalReward } },
      });

      // 2. Insert PointHistory
      await this.prisma.pointHistory.create({
        data: {
          userId: winner.userId,
          points: totalReward,
          reason: isForfeit
            ? `Thắng do đối thủ bỏ cuộc trong Đấu Trường 1v1 (${match.matchId})`
            : `Thắng trận Đấu Trường 1v1 (${match.matchId})`,
        },
      });

      // 3. Insert CurrencyTransaction
      await this.prisma.currencyTransaction.create({
        data: {
          studentId: winner.userId,
          studentName: winner.userName,
          userId: winner.userId,
          userName: winner.userName,
          userRole: 'STUDENT',
          amount: totalReward,
          reason: isForfeit
            ? `Thắng do đối thủ bỏ cuộc Đấu Trường 1v1`
            : `Chiến thắng Đấu Trường 1v1`,
          type: 'add',
        },
      });

      // 4. Real-time balance notification to Winner
      this.eventsGateway.sendCurrencyUpdate(winner.userId, {
        amount: totalReward,
        newBalance: updatedStats.totalBanhRan,
        reason: `Chiến thắng Đấu Trường 1v1 (+${totalReward} 🍞)`,
        studentName: winner.userName,
      });
    } else {
      // Draw: Refund escrow stakes to both players
      const p1Stats = await this.prisma.userStats.update({
        where: { userId: match.p1.userId },
        data: { totalBanhRan: { increment: match.stake } },
      });
      const p2Stats = await this.prisma.userStats.update({
        where: { userId: match.p2.userId },
        data: { totalBanhRan: { increment: match.stake } },
      });

      await this.prisma.currencyTransaction.createMany({
        data: [
          {
            studentId: match.p1.userId,
            studentName: match.p1.userName,
            userId: match.p1.userId,
            userName: match.p1.userName,
            userRole: 'STUDENT',
            amount: match.stake,
            reason: `Hoàn cược Đấu Trường 1v1 do Hòa nhau (${match.matchId})`,
            type: 'add',
          },
          {
            studentId: match.p2.userId,
            studentName: match.p2.userName,
            userId: match.p2.userId,
            userName: match.p2.userName,
            userRole: 'STUDENT',
            amount: match.stake,
            reason: `Hoàn cược Đấu Trường 1v1 do Hòa nhau (${match.matchId})`,
            type: 'add',
          },
        ],
      });

      this.eventsGateway.sendCurrencyUpdate(match.p1.userId, {
        amount: match.stake,
        newBalance: p1Stats.totalBanhRan,
        reason: `Hoàn cược Đấu Trường 1v1 (Hòa nhau)`,
        studentName: match.p1.userName,
      });

      this.eventsGateway.sendCurrencyUpdate(match.p2.userId, {
        amount: match.stake,
        newBalance: p2Stats.totalBanhRan,
        reason: `Hoàn cược Đấu Trường 1v1 (Hòa nhau)`,
        studentName: match.p2.userName,
      });
    }

    // Save final match state with short TTL (10 mins)
    await this.redis.set(
      `arena:match:${match.matchId}`,
      JSON.stringify(match),
      'EX',
      600,
    );
    await this.redis.del(`arena:user_match:${match.p1.userId}`);
    await this.redis.del(`arena:user_match:${match.p2.userId}`);

    // Emit match ended event
    this.server.to(match.matchId).emit('arena:match_ended', {
      matchId: match.matchId,
      winnerRole,
      winnerUserId,
      isForfeit,
      p1: {
        userId: match.p1.userId,
        userName: match.p1.userName,
        score: match.p1.score,
      },
      p2: {
        userId: match.p2.userId,
        userName: match.p2.userName,
        score: match.p2.score,
      },
      reward: winnerUserId ? totalReward : match.stake,
      isDraw: winnerRole === 'draw',
    });

    this.logger.log(
      `[Arena] [${match.matchId}] Match finalized. Winner: ${winnerRole} (${winnerUserId || 'Draw'})`,
    );
  }

  // ==========================================
  // QUESTION POOLING HELPER
  // ==========================================

  private async fetchArenaQuestions(
    count: number = 5,
  ): Promise<ServerQuestion[]> {
    const questions: ServerQuestion[] = [];

    try {
      // 1. Fetch random MCQs from Question table
      const mcqQuestions = await this.prisma.question.findMany({
        where: { type: 'MULTIPLE_CHOICE' },
        take: 40,
      });

      if (mcqQuestions.length > 0) {
        const shuffled = mcqQuestions.sort(() => Math.random() - 0.5);
        for (const item of shuffled) {
          if (questions.length >= count) break;
          const content = item.content as any;
          if (
            content?.question &&
            Array.isArray(content?.options) &&
            content?.correctAnswer
          ) {
            questions.push({
              id: item.id,
              prompt: content.question,
              ipa: content.ipa || '',
              options: [...content.options].sort(() => Math.random() - 0.5),
              correctAnswer: content.correctAnswer,
              explanation: content.explanation || '',
            });
          }
        }
      }

      // 2. If needed, supplement with VocabWords
      if (questions.length < count) {
        const needed = count - questions.length;
        const words = await this.prisma.vocabWord.findMany({
          take: 30,
        });

        if (words.length > 0) {
          const shuffledWords = words.sort(() => Math.random() - 0.5);
          for (let i = 0; i < Math.min(needed, shuffledWords.length); i++) {
            const w = shuffledWords[i];
            const distractorWords = shuffledWords
              .filter((sw) => sw.id !== w.id)
              .slice(0, 3);
            const options = [
              w.meaning,
              ...(distractorWords.length >= 3
                ? distractorWords.map((dw) => dw.meaning)
                : [
                    'Thỏa thuận kinh doanh',
                    'Sự khởi hành thuận lợi',
                    'Kế hoạch dự phòng',
                  ]),
            ].sort(() => Math.random() - 0.5);

            questions.push({
              id: 1000 + w.id,
              prompt: `Nghĩa của từ "${w.word}" (${w.pos}) là gì?`,
              ipa: w.ipaUs || w.ipaUk || '',
              options,
              correctAnswer: w.meaning,
              explanation: `Từ "${w.word}" (${w.pos}) có nghĩa là: ${w.meaning}. Ví dụ: ${w.exampleEn || w.exampleVi || ''}`,
            });
          }
        }
      }
    } catch (err) {
      this.logger.error('[Arena] Error fetching arena questions:', err);
    }

    // Fallback static questions if DB query failed
    if (questions.length < count) {
      const fallback = [
        {
          id: 9001,
          prompt:
            "Customer _______ is our corporation's top priority this quarter.",
          ipa: 'sætɪsˈfækʃən',
          options: ['satisfaction', 'satisfy', 'satisfactory', 'satisfied'],
          correctAnswer: 'satisfaction',
          explanation:
            'Đứng sau danh từ "Customer" cần danh từ "satisfaction" (Sự hài lòng của khách hàng).',
        },
        {
          id: 9002,
          prompt:
            'Mr. David usually _______ the weekly sales report every Monday morning.',
          ipa: 'səbˈmɪts',
          options: ['submits', 'submitted', 'submitting', 'submit'],
          correctAnswer: 'submits',
          explanation:
            'Chủ ngữ ngôi thứ ba số ít và trạng từ "usually" -> chia hiện tại đơn: submits.',
        },
        {
          id: 9003,
          prompt:
            'Since we adopted the new system, productivity _______ by 25 percent.',
          ipa: 'hæz ɪnˈkriːst',
          options: ['has increased', 'increased', 'increases', 'is increasing'],
          correctAnswer: 'has increased',
          explanation:
            'Cấu trúc Since + mốc QK, Mệnh đề chính chia Hiện tại hoàn thành: has increased.',
        },
        {
          id: 9004,
          prompt: 'Please submit your _______ before Friday afternoon.',
          ipa: 'ˌæplɪˈkeɪʃən',
          options: ['application', 'apply', 'applicant', 'applicable'],
          correctAnswer: 'application',
          explanation:
            'Sau tính từ sở hữu "your" cần danh từ chỉ đơn từ: application.',
        },
        {
          id: 9005,
          prompt:
            'The new manager showed remarkable _______ during the team transition.',
          ipa: 'ˈliːdərʃɪp',
          options: ['leadership', 'lead', 'leader', 'leading'],
          correctAnswer: 'leadership',
          explanation:
            'Sau tính từ "remarkable" cần danh từ trừu tượng: leadership (khả năng lãnh đạo).',
        },
      ];
      return fallback.slice(0, count);
    }

    return questions.slice(0, count);
  }
}
