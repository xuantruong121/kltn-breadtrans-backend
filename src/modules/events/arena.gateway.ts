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
import { PrismaService } from '../../prisma/prisma.service';

interface QueuePlayer {
  socketId: string;
  userId: number;
  userName: string;
  stake: number;
  gameId: string;
}

interface ActiveRoom {
  roomId: string;
  p1: {
    userId: number;
    socketId: string;
    userName: string;
    score: number;
    answeredCount: number;
  };
  p2: {
    userId: number;
    socketId: string;
    userName: string;
    score: number;
    answeredCount: number;
  };
  stake: number;
  questions: any[];
  isSettled: boolean;
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

  private logger: Logger = new Logger('ArenaGateway');
  private queue: QueuePlayer[] = [];
  private rooms: Map<string, ActiveRoom> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  handleConnection(client: Socket) {
    this.logger.log(`[Arena] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[Arena] Client disconnected: ${client.id}`);
    this.queue = this.queue.filter((p) => p.socketId !== client.id);
  }

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

    // Verify user has enough Bánh Mì
    const userStats = await this.prisma.userStats.findUnique({
      where: { userId },
    });

    if (!userStats || userStats.totalBanhRan < stake) {
      client.emit('arena:error', {
        message: `Bạn không đủ ${stake} Bánh Mì để tham gia đấu trường!`,
      });
      return;
    }

    // Remove any existing entries for this user
    this.queue = this.queue.filter((p) => p.userId !== userId);

    // Look for a suitable opponent in queue
    const opponentIndex = this.queue.findIndex(
      (p) => p.stake === stake && p.gameId === gameId && p.userId !== userId,
    );

    if (opponentIndex !== -1) {
      const opponent = this.queue.splice(opponentIndex, 1)[0];
      const roomId = `room_${Date.now()}_${userId}_${opponent.userId}`;

      // Pick 5 random vocab words or questions
      const words = await this.prisma.vocabWord.findMany({
        take: 5,
        orderBy: { id: 'asc' },
      });

      const questions = words.map((w, idx) => ({
        id: idx + 1,
        prompt: `Nghĩa của từ "${w.word}" (${w.pos}) là gì?`,
        ipa: w.ipaUs || w.ipaUk || '',
        correctAnswer: w.meaning,
        options: [
          w.meaning,
          'Thỏa thuận kinh doanh',
          'Sự khởi hành',
          'Kế hoạch dự phòng',
        ].sort(() => Math.random() - 0.5),
      }));

      const activeRoom: ActiveRoom = {
        roomId,
        p1: {
          userId,
          socketId: client.id,
          userName,
          score: 0,
          answeredCount: 0,
        },
        p2: {
          userId: opponent.userId,
          socketId: opponent.socketId,
          userName: opponent.userName,
          score: 0,
          answeredCount: 0,
        },
        stake,
        questions,
        isSettled: false,
      };

      this.rooms.set(roomId, activeRoom);

      // Join socket room
      await client.join(roomId);
      const opponentSocket = this.server.sockets.sockets.get(opponent.socketId);
      if (opponentSocket) {
        await opponentSocket.join(roomId);
      }

      // Escrow stakes
      await this.prisma.userStats.update({
        where: { userId },
        data: { totalBanhRan: { decrement: stake } },
      });
      await this.prisma.userStats.update({
        where: { userId: opponent.userId },
        data: { totalBanhRan: { decrement: stake } },
      });

      // Create GameBattle in DB
      await this.prisma.gameBattle.create({
        data: {
          roomId,
          gameId,
          p1Id: userId,
          p2Id: opponent.userId,
          stake,
          status: 'escrowed',
        },
      });

      this.server.to(roomId).emit('arena:match_found', {
        roomId,
        stake,
        player1: { userId, userName },
        player2: { userId: opponent.userId, userName: opponent.userName },
        questions,
      });
    } else {
      // Add to queue
      this.queue.push({
        socketId: client.id,
        userId,
        userName,
        stake,
        gameId,
      });

      client.emit('arena:waiting', {
        message: 'Đang tìm kiếm đối thủ xứng tầm...',
        queueSize: this.queue.length,
      });
    }
  }

  @SubscribeMessage('cancel_queue')
  handleCancelQueue(@ConnectedSocket() client: Socket) {
    this.queue = this.queue.filter((p) => p.socketId !== client.id);
    client.emit('arena:cancelled', { message: 'Đã hủy ghép trận.' });
  }

  @SubscribeMessage('submit_answer')
  async handleSubmitAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      roomId: string;
      userId: number;
      questionIndex: number;
      isCorrect: boolean;
    },
  ) {
    const room = this.rooms.get(payload.roomId);
    if (!room || room.isSettled) return;

    const isP1 = room.p1.userId === payload.userId;
    const player = isP1 ? room.p1 : room.p2;

    if (payload.isCorrect) {
      player.score += 100;
    }
    player.answeredCount += 1;

    // Broadcast current progress to both
    this.server.to(payload.roomId).emit('arena:progress_update', {
      p1: {
        userId: room.p1.userId,
        score: room.p1.score,
        answered: room.p1.answeredCount,
      },
      p2: {
        userId: room.p2.userId,
        score: room.p2.score,
        answered: room.p2.answeredCount,
      },
    });

    // Check if both completed all 5 questions
    const totalQ = room.questions.length;
    if (room.p1.answeredCount >= totalQ && room.p2.answeredCount >= totalQ) {
      await this.settleBattle(room);
    }
  }

  private async settleBattle(room: ActiveRoom) {
    if (room.isSettled) return;
    room.isSettled = true;

    let winnerRole = 'draw';
    let winnerUserId: number | null = null;
    const totalReward = room.stake * 2;

    if (room.p1.score > room.p2.score) {
      winnerRole = 'p1';
      winnerUserId = room.p1.userId;
      // Winner takes all
      await this.prisma.userStats.update({
        where: { userId: room.p1.userId },
        data: { totalBanhRan: { increment: totalReward } },
      });
      await this.prisma.pointHistory.create({
        data: {
          userId: room.p1.userId,
          points: totalReward,
          reason: `Thắng trận Đấu Trường 1v1 (${room.roomId})`,
        },
      });
    } else if (room.p2.score > room.p1.score) {
      winnerRole = 'p2';
      winnerUserId = room.p2.userId;
      await this.prisma.userStats.update({
        where: { userId: room.p2.userId },
        data: { totalBanhRan: { increment: totalReward } },
      });
      await this.prisma.pointHistory.create({
        data: {
          userId: room.p2.userId,
          points: totalReward,
          reason: `Thắng trận Đấu Trường 1v1 (${room.roomId})`,
        },
      });
    } else {
      // Refund
      await this.prisma.userStats.update({
        where: { userId: room.p1.userId },
        data: { totalBanhRan: { increment: room.stake } },
      });
      await this.prisma.userStats.update({
        where: { userId: room.p2.userId },
        data: { totalBanhRan: { increment: room.stake } },
      });
    }

    // Update GameBattle
    await this.prisma.gameBattle.updateMany({
      where: { roomId: room.roomId },
      data: {
        status: 'settled',
        winnerRole,
        winnerUserId,
        settledAt: new Date(),
      },
    });

    this.server.to(room.roomId).emit('arena:match_ended', {
      winnerRole,
      winnerUserId,
      p1: { userId: room.p1.userId, score: room.p1.score },
      p2: { userId: room.p2.userId, score: room.p2.score },
      reward: winnerUserId ? totalReward : room.stake,
    });

    this.rooms.delete(room.roomId);
  }
}
