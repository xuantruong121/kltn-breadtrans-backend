import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { getJwtSecret } from '../auth/auth.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportService } from '../support/support.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import * as crypto from 'crypto';

const getSocketCorsConfig = () => {
  if (process.env.NODE_ENV !== 'production') {
    return { origin: true, credentials: true };
  }
  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  };
};

@WebSocketGateway({
  cors: getSocketCorsConfig(),
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger('EventsGateway');

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
    private readonly supportService: SupportService,
  ) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      this.logger.warn(
        `[EventsGateway] Connection rejected: Missing auth token (${client.id})`,
      );
      client.emit('auth:error', { message: 'Authentication token required' });
      client.disconnect(true);
      return;
    }

    try {
      const secret = getJwtSecret();
      const payload = this.jwtService.verify(token, { secret });
      if (payload.type !== 'access' || !payload.deviceId) {
        throw new Error('Access token required');
      }
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      if (await this.redis.get(`jwt:denylist:${tokenHash}`)) {
        throw new Error('Token revoked');
      }
      const loggedOutAt = await this.redis.get(
        `user:${payload.sub}:device:${payload.deviceId}:logged_out_at`,
      );
      if (
        loggedOutAt &&
        payload.iat &&
        payload.iat * 1000 < Number(loggedOutAt)
      ) {
        throw new Error('Device session revoked');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { profile: true },
      });
      if (!user) throw new Error('User not found');
      if (user.role !== 'ADMIN' && user.role !== 'STUDENT') {
        throw new Error('Unsupported role');
      }
      client.data.user = {
        userId: user.id,
        email: user.email,
        role: user.role,
        deviceId: payload.deviceId,
        profile: user.profile,
      };

      const userRoom = `user_${user.id}`;
      await client.join(userRoom);

      if (user.role === 'ADMIN') {
        await client.join('admins');
        await client.join('support_staff');
      }

      this.logger.log(
        `[EventsGateway] Client authenticated: ${client.id} (User #${user.id}, ${user.role})`,
      );
    } catch {
      this.logger.warn(
        `[EventsGateway] Connection rejected: Invalid auth token (${client.id})`,
      );
      client.emit('auth:error', {
        message: 'Invalid or expired authentication token',
      });
      client.disconnect(true);
      return;
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // 1. Người dùng tham gia Room cá nhân & Room hỗ trợ (xác thực nghiêm ngặt từ token, không tin payload client)
  @SubscribeMessage('joinUserRoom')
  async handleJoinUserRoom(@ConnectedSocket() client: Socket) {
    const authUser = client.data?.user;
    if (!authUser) {
      client.disconnect(true);
      return;
    }

    const userRoom = `user_${authUser.userId}`;
    await client.join(userRoom);
    this.logger.log(`Client ${client.id} joined personal room: ${userRoom}`);

    if (authUser.role === 'ADMIN') {
      await client.join('admins');
      await client.join('support_staff');
      this.logger.log(
        `Client ${client.id} (ADMIN) joined 'admins' and 'support_staff' rooms`,
      );
    }
  }

  // 1.5. Lắng nghe event từ SupportService để phát sóng Socket real-time sau khi đã lưu DB thành công
  @OnEvent('support.message_created')
  handleSupportMessageCreated(payload: {
    conversationId: number;
    studentId: number;
    fromRole: string;
    targetUserId?: number;
    message: any;
    student: {
      id: number;
      name: string;
      email: string;
      avatar?: string | null;
    };
  }) {
    const socketPayload = {
      conversationId: payload.conversationId,
      studentId: `student_${payload.studentId}`,
      studentName: payload.student.name,
      studentEmail: payload.student.email,
      studentAvatar: payload.student.avatar,
      fromRole: payload.fromRole,
      targetUserId: payload.targetUserId || payload.studentId,
      message: payload.message,
    };

    // Gửi cho Support Staff (Admin)
    this.server.to('support_staff').emit('chat:new_message', socketPayload);

    // Gửi cho phòng cá nhân của học sinh
    this.server
      .to(`user_${payload.studentId}`)
      .emit('chat:new_message', socketPayload);
  }

  @OnEvent('support.mode_updated')
  handleSupportModeUpdated(payload: {
    conversationId: number;
    studentId: number;
    mode: 'AI' | 'HUMAN';
    adminName: string;
  }) {
    const socketPayload = {
      conversationId: payload.conversationId,
      studentId: `student_${payload.studentId}`,
      mode: payload.mode,
      adminName: payload.adminName,
      targetUserId: payload.studentId,
    };

    this.server
      .to(`user_${payload.studentId}`)
      .emit('chat:mode_updated', socketPayload);
    this.server.to('support_staff').emit('chat:mode_updated', socketPayload);
  }

  // 2. Chat Real-time giữa Học sinh và Support Staff (Admin) — Lưu PostgreSQL trước, phát sóng sau
  @SubscribeMessage('chat:sendMessage')
  async handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      studentId?: string;
      studentName?: string;
      studentEmail?: string;
      studentAvatar?: string | null;
      message?: {
        id?: string;
        role: 'user' | 'assistant' | 'admin' | 'system';
        content: string;
        senderName?: string;
        timestamp?: number;
      };
      fromRole?: 'STUDENT' | 'ADMIN' | 'TEACHER';
      targetUserId?: number;
    },
  ) {
    const authUser = client.data?.user;
    if (!authUser) {
      client.disconnect(true);
      return;
    }

    const content = payload?.message?.content;
    if (
      typeof content !== 'string' ||
      content.trim().length === 0 ||
      content.length > 2000
    ) {
      return;
    }

    const isStaff = authUser.role === 'ADMIN';

    this.logger.log(
      `Chat message from ${authUser.role} (User #${authUser.userId}): "${content.substring(0, 30)}..."`,
    );

    try {
      if (!isStaff) {
        // 1. Tin nhắn từ Học sinh hoặc phản hồi AI: xác thực, lưu DB trước
        const conv = await this.supportService.getOrCreateStudentConversation(
          authUser.userId,
        );
        if (payload.message?.role === 'assistant') {
          await this.supportService.createAiMessage(
            conv.id,
            content,
            payload.message?.id,
          );
        } else {
          await this.supportService.sendStudentMessage(
            authUser.userId,
            conv.id,
            {
              content,
              clientMessageId: payload.message?.id,
            },
          );
        }
      } else {
        // 2. Tin nhắn từ Support Staff (Admin) trả lời:
        const targetUserId =
          payload.targetUserId ||
          Number(payload.studentId?.replace('student_', '')) ||
          null;
        if (!targetUserId) return;

        const conv =
          await this.supportService.getOrCreateStudentConversation(
            targetUserId,
          );
        await this.supportService.sendAdminMessage(authUser.userId, conv.id, {
          content,
          clientMessageId: payload.message?.id,
        });
      }
    } catch (err: any) {
      this.logger.error(`Error handling chat message: ${err?.message}`);
      client.emit('chat:error', { message: 'Failed to process message' });
    }
  }

  // 3. Chuyển đổi chế độ AI <-> Human của học sinh Real-time — Lưu DB trước
  @SubscribeMessage('chat:toggleMode')
  async handleToggleMode(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      studentId: string;
      mode: 'AI' | 'HUMAN';
      adminName?: string;
      targetUserId?: number;
    },
  ) {
    const authUser = client.data?.user;
    if (!authUser) return;

    if (!['AI', 'HUMAN'].includes(payload.mode)) return;

    const targetUserId =
      authUser.role === 'ADMIN'
        ? payload.targetUserId ||
          Number(payload.studentId?.replace('student_', '')) ||
          null
        : authUser.userId;

    if (!targetUserId) return;

    try {
      const conv =
        await this.supportService.getOrCreateStudentConversation(targetUserId);
      await this.supportService.updateConversationMode(conv.id, payload.mode, {
        id: authUser.userId,
        role: authUser.role,
      });
    } catch (err: any) {
      this.logger.error(`Error toggling chat mode: ${err?.message}`);
    }
  }

  // ==========================================
  // HELPER METHODS (Dành cho các Service gọi)
  // ==========================================

  // Bắn sự kiện Bánh Mì thay đổi tức thì cho học sinh
  sendCurrencyUpdate(
    userId: number,
    payload: {
      amount: number;
      newBalance: number;
      reason: string;
      studentName: string;
    },
  ) {
    this.logger.log(
      `Sending currency update to user_${userId}: ${payload.amount >= 0 ? '+' : ''}${payload.amount} Bánh Mì (New: ${payload.newBalance})`,
    );

    this.server.to(`user_${userId}`).emit('user:currency_updated', {
      userId,
      ...payload,
      timestamp: new Date().toISOString(),
    });

    this.server.to('admins').emit('user:currency_updated', {
      userId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  // Bắn sự kiện Duyệt/Từ chối đơn hàng Đổi Quà cho học sinh
  sendOrderReviewUpdate(
    userId: number,
    payload: {
      orderId: number;
      status: string;
      totalBanh: number;
      remainingBanh?: number;
      reviewerName: string;
    },
  ) {
    this.logger.log(
      `Sending market order update to user_${userId}: Order #${payload.orderId} is ${payload.status}`,
    );

    this.server.to(`user_${userId}`).emit('market:order_updated', {
      userId,
      ...payload,
      timestamp: new Date().toISOString(),
    });

    this.server.to('admins').emit('market:order_updated', {
      userId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  // Broadcast toàn hệ thống khi một Khóa học được duyệt
  broadcastCourseUpdate() {
    this.server.emit('courseUpdated', {
      message: 'A course status has been updated',
      timestamp: new Date().toISOString(),
    });
  }
}
