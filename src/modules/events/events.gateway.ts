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
import { JwtService } from '@nestjs/jwt';
import { getJwtSecret } from '../auth/auth.constants';
import { PrismaService } from '../../prisma/prisma.service';
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
      if (loggedOutAt && payload.iat && payload.iat * 1000 < Number(loggedOutAt)) {
        throw new Error('Device session revoked');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { profile: true },
      });
      if (!user) throw new Error('User not found');
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
      } else if (user.role === 'TEACHER') {
        await client.join('support_staff');
      }

      this.logger.log(
        `[EventsGateway] Client authenticated: ${client.id} (User #${user.id}, ${user.role})`,
      );
    } catch (err) {
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
  async handleJoinUserRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() _data?: { userId?: number; role?: string; name?: string },
  ) {
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
    } else if (authUser.role === 'TEACHER') {
      await client.join('support_staff');
      this.logger.log(
        `Client ${client.id} (TEACHER) joined 'support_staff' room`,
      );
    }
  }

  // 2. Chat Real-time giữa Học sinh và Support Staff (Admin / Teacher)
  @SubscribeMessage('chat:sendMessage')
  async handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      studentId?: string;
      studentName?: string;
      studentEmail?: string;
      studentAvatar?: string;
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

    const userRole = authUser.role;
    const isStaff = userRole === 'ADMIN' || userRole === 'TEACHER';

    this.logger.log(
      `Chat message from ${userRole} (User #${authUser.userId}): "${payload.message?.content?.substring(0, 30)}..."`,
    );

    const content = payload?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0 || content.length > 2000) {
      return;
    }

    if (!isStaff) {
      const student = await this.prisma.user.findUnique({
        where: { id: authUser.userId },
        include: { profile: true },
      });
      if (!student) return;
      // 1. Tin nhắn từ Học sinh gửi lên: gửi cho Support Staff (Admin + Teacher)
      const sanitizedPayload = {
        studentName: student.profile?.fullName || student.email,
        studentEmail: student.email,
        studentAvatar: student.profile?.avatar || undefined,
        fromRole: 'STUDENT',
        studentId: `student_${authUser.userId}`,
        message: {
          id: payload.message?.id,
          role: 'user',
          content,
          senderName: student.profile?.fullName || student.email,
          timestamp: payload.message?.timestamp || Date.now(),
        },
      };

      this.server.to('support_staff').emit('chat:new_message', sanitizedPayload);

      // Nếu học sinh mở nhiều tab, gửi cho các tab khác của chính học sinh này
      client.to(`user_${authUser.userId}`).emit('chat:new_message', sanitizedPayload);
    } else {
      // 2. Tin nhắn từ Support Staff (Admin / Teacher) trả lời học sinh:
      const targetUserId =
        payload.targetUserId ||
        Number(payload.studentId?.replace('student_', '')) ||
        null;
      if (!targetUserId) return;
      const student = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        include: { profile: true },
      });
      if (!student) return;

      const staffPayload = {
        studentId: `student_${student.id}`,
        studentName: student.profile?.fullName || student.email,
        studentEmail: student.email,
        studentAvatar: student.profile?.avatar || undefined,
        fromRole: userRole,
        targetUserId: student.id,
        message: {
          id: payload.message?.id,
          role: 'admin',
          content,
          senderName: authUser.profile?.fullName || authUser.email,
          timestamp: payload.message?.timestamp || Date.now(),
        },
      };

      if (targetUserId) {
        // Gửi thẳng cho học sinh được chỉ định
        this.server
          .to(`user_${targetUserId}`)
          .emit('chat:new_message', staffPayload);
      }

      // Gửi cho các thành viên support staff khác theo dõi
      client.to('support_staff').emit('chat:new_message', staffPayload);
    }
  }

  // 3. Support Staff chuyển đổi chế độ AI <-> Human của học sinh Real-time
  @SubscribeMessage('chat:toggleMode')
  async handleToggleMode(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      studentId: string;
      mode: 'AI' | 'HUMAN';
      adminName: string;
      targetUserId?: number;
    },
  ) {
    const authUser = client.data?.user;
    if (!authUser || (authUser.role !== 'ADMIN' && authUser.role !== 'TEACHER')) {
      this.logger.warn(
        `[EventsGateway] Unauthorized chat:toggleMode attempt by User #${authUser?.userId}`,
      );
      return;
    }

    const requestedTargetUserId = payload.targetUserId;
    const targetUserId: number | null =
      typeof requestedTargetUserId === 'number' &&
      Number.isInteger(requestedTargetUserId) &&
      requestedTargetUserId > 0
        ? requestedTargetUserId
        : Number(payload.studentId?.replace('student_', '')) ||
      null;
    if (!targetUserId || !['AI', 'HUMAN'].includes(payload.mode)) return;
    const student = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: { profile: true },
    });
    if (!student) return;
    const normalizedPayload = {
      studentId: `student_${student.id}`,
      mode: payload.mode,
      adminName: authUser.profile?.fullName || authUser.email,
      targetUserId: student.id,
    };

    this.logger.log(
      'Chat mode toggled for ' + normalizedPayload.studentId + ' by ' + authUser.role,
    );

    this.server.to('support_staff').emit('chat:mode_updated', normalizedPayload);

    if (targetUserId) {
      this.server.to(`user_${targetUserId}`).emit('chat:mode_updated', normalizedPayload);
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
