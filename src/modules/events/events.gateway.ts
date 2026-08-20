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

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger('EventsGateway');

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // 1. Người dùng tham gia Room cá nhân & Room quản trị
  @SubscribeMessage('joinUserRoom')
  async handleJoinUserRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: number; role?: string; name?: string },
  ) {
    if (!data?.userId) return;
    const userRoom = `user_${data.userId}`;
    await client.join(userRoom);
    this.logger.log(`Client ${client.id} joined personal room: ${userRoom}`);

    if (data.role === 'ADMIN' || data.role === 'TEACHER') {
      await client.join('admins');
      this.logger.log(
        `Client ${client.id} (${data.role}) joined 'admins' room`,
      );
    }
  }

  // 2. Chat Real-time giữa Học sinh và Admin / Teacher
  @SubscribeMessage('chat:sendMessage')
  handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      studentId: string;
      studentName: string;
      studentEmail?: string;
      studentAvatar?: string;
      message: {
        id?: string;
        role: 'user' | 'assistant' | 'admin' | 'system';
        content: string;
        senderName?: string;
        timestamp?: number;
      };
      fromRole: 'STUDENT' | 'ADMIN' | 'TEACHER';
      targetUserId?: number;
    },
  ) {
    this.logger.log(
      `Chat message from ${payload.fromRole} (${payload.studentName}): "${payload.message.content.substring(0, 30)}..."`,
    );

    // 1. Nếu tin nhắn từ Học sinh gửi lên:
    if (payload.fromRole === 'STUDENT') {
      // Gửi cho toàn bộ Admin & Giáo viên
      this.server.to('admins').emit('chat:new_message', payload);

      // Nếu học sinh mở nhiều tab, gửi cho các tab khác (trừ tab đang gửi)
      const targetUserId =
        payload.targetUserId ||
        Number(payload.studentId.replace('student_', '')) ||
        null;
      if (targetUserId) {
        client.to(`user_${targetUserId}`).emit('chat:new_message', payload);
      }
    } else {
      // 2. Nếu tin nhắn từ Admin / Giáo viên trả lời:
      const targetUserId =
        payload.targetUserId ||
        Number(payload.studentId.replace('student_', '')) ||
        null;
      if (targetUserId) {
        // Gửi thẳng cho học sinh đó
        this.server
          .to(`user_${targetUserId}`)
          .emit('chat:new_message', payload);
      }

      // Gửi cho các Admin khác theo dõi (trừ Admin vừa gửi)
      client.to('admins').emit('chat:new_message', payload);
    }
  }

  // 3. Admin chuyển đổi chế độ AI <-> Human của học sinh Real-time
  @SubscribeMessage('chat:toggleMode')
  handleToggleMode(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      studentId: string;
      mode: 'AI' | 'HUMAN';
      adminName: string;
      targetUserId?: number;
    },
  ) {
    this.logger.log(
      `Chat mode toggled for ${payload.studentId} -> ${payload.mode} by ${payload.adminName}`,
    );

    this.server.to('admins').emit('chat:mode_updated', payload);

    const targetUserId =
      payload.targetUserId ||
      Number(payload.studentId.replace('student_', '')) ||
      null;

    if (targetUserId) {
      this.server.to(`user_${targetUserId}`).emit('chat:mode_updated', payload);
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
