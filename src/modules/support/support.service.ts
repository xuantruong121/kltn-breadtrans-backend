import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { SupportQueryDto } from './dto/support-query.dto';

@Injectable()
export class SupportService {
  private readonly logger = new Logger('SupportService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Helper access to support models typed via PrismaService
  private get db(): PrismaService {
    return this.prisma;
  }

  // 1. Get or create single active support conversation for a student
  async getOrCreateStudentConversation(studentId: number) {
    let conversation = await this.db.supportConversation.findUnique({
      where: { studentId },
      include: {
        student: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      conversation = await this.db.supportConversation.create({
        data: {
          studentId,
          mode: 'AI',
          status: 'OPEN',
          lastMessageAt: new Date(),
        },
        include: {
          student: {
            select: {
              id: true,
              email: true,
              profile: {
                select: {
                  fullName: true,
                  avatar: true,
                },
              },
            },
          },
        },
      });
      this.logger.log(
        `Created new SupportConversation #${conversation.id} for student #${studentId}`,
      );
    }

    const unreadCount = await this.db.supportMessage.count({
      where: {
        conversationId: conversation.id,
        senderRole: 'ADMIN',
        isRead: false,
      },
    });

    return {
      ...conversation,
      unreadCount,
    };
  }

  // 2. Get student messages (paginated, strictly scoped to conversation owner)
  async getStudentMessages(
    studentId: number,
    conversationId: number,
    query: SupportQueryDto,
  ) {
    const conversation = await this.db.supportConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.studentId !== studentId) {
      throw new ForbiddenException(
        'You do not have permission to view this conversation',
      );
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const skip = (page - 1) * limit;

    const [total, messages] = await Promise.all([
      this.db.supportMessage.count({
        where: { conversationId },
      }),
      this.db.supportMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    // Mark admin messages as read
    await this.db.supportMessage.updateMany({
      where: {
        conversationId,
        senderRole: 'ADMIN',
        isRead: false,
      },
      data: { isRead: true },
    });

    return {
      data: messages,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      mode: conversation.mode,
    };
  }

  // 3. Send message from student
  async sendStudentMessage(
    studentId: number,
    conversationId: number,
    dto: CreateSupportMessageDto,
  ) {
    const conversation = await this.db.supportConversation.findUnique({
      where: { id: conversationId },
      include: {
        student: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.studentId !== studentId) {
      throw new ForbiddenException(
        'You do not have permission to post to this conversation',
      );
    }

    // Idempotency check: if clientMessageId already exists in this conversation, return it
    if (dto.clientMessageId) {
      const existing = await this.db.supportMessage.findFirst({
        where: {
          conversationId,
          clientMessageId: dto.clientMessageId,
        },
      });
      if (existing) {
        return existing;
      }
    }

    const studentName =
      conversation.student.profile?.fullName || conversation.student.email;

    const message = await this.db.supportMessage.create({
      data: {
        conversationId,
        senderUserId: studentId,
        senderRole: 'STUDENT',
        senderName: studentName,
        content: dto.content.trim(),
        clientMessageId: dto.clientMessageId || null,
        isRead: false,
      },
    });

    await this.db.supportConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    // Emit event for real-time websocket broadcast
    this.eventEmitter.emit('support.message_created', {
      conversationId,
      studentId,
      fromRole: 'STUDENT',
      targetUserId: studentId,
      message: {
        id: message.id,
        clientMessageId: message.clientMessageId,
        role: 'user',
        content: message.content,
        senderName: message.senderName,
        timestamp: message.createdAt.getTime(),
      },
      student: {
        id: conversation.student.id,
        name: studentName,
        email: conversation.student.email,
        avatar: conversation.student.profile?.avatar,
      },
    });

    return message;
  }

  // 4. Create AI reply message in conversation
  async createAiMessage(
    conversationId: number,
    content: string,
    clientMessageId?: string,
  ) {
    const conversation = await this.db.supportConversation.findUnique({
      where: { id: conversationId },
      include: {
        student: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) return null;

    if (clientMessageId) {
      const existing = await this.db.supportMessage.findFirst({
        where: {
          conversationId,
          clientMessageId,
        },
      });
      if (existing) {
        return existing;
      }
    }

    const message = await this.db.supportMessage.create({
      data: {
        conversationId,
        senderUserId: null,
        senderRole: 'AI',
        senderName: 'Trợ Lý Bánh Mì 🍞',
        content: content.trim(),
        clientMessageId: clientMessageId || null,
        isRead: true,
      },
    });

    await this.db.supportConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    const studentName =
      conversation.student.profile?.fullName || conversation.student.email;

    this.eventEmitter.emit('support.message_created', {
      conversationId,
      studentId: conversation.studentId,
      fromRole: 'AI',
      targetUserId: conversation.studentId,
      message: {
        id: message.id,
        role: 'assistant',
        content: message.content,
        senderName: message.senderName,
        timestamp: message.createdAt.getTime(),
      },
      student: {
        id: conversation.student.id,
        name: studentName,
        email: conversation.student.email,
        avatar: conversation.student.profile?.avatar,
      },
    });

    return message;
  }

  // 5. Admin: List all conversations
  async getAdminConversations(query: SupportQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const skip = (page - 1) * limit;

    const [total, conversations] = await Promise.all([
      this.db.supportConversation.count(),
      this.db.supportConversation.findMany({
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
        include: {
          student: {
            select: {
              id: true,
              email: true,
              profile: {
                select: {
                  fullName: true,
                  avatar: true,
                },
              },
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    const formatted = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await this.db.supportMessage.count({
          where: {
            conversationId: conv.id,
            senderRole: 'STUDENT',
            isRead: false,
          },
        });

        const lastMsg = conv.messages?.[0] || null;
        const lastMessageTime = conv.lastMessageAt
          ? new Date(conv.lastMessageAt).getTime()
          : new Date(conv.createdAt).getTime();

        return {
          id: conv.id,
          studentId: conv.studentId,
          studentName: conv.student.profile?.fullName || conv.student.email,
          studentEmail: conv.student.email,
          studentAvatar: conv.student.profile?.avatar,
          mode: conv.mode,
          status: conv.status,
          unreadCount,
          lastMessageTime,
          lastMessage: lastMsg
            ? {
                id: lastMsg.id,
                content: lastMsg.content,
                role: lastMsg.senderRole,
                timestamp: new Date(lastMsg.createdAt).getTime(),
              }
            : null,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        };
      }),
    );

    return {
      data: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 6. Admin: Get single conversation
  async getAdminConversation(conversationId: number) {
    const conversation = await this.db.supportConversation.findUnique({
      where: { id: conversationId },
      include: {
        student: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const unreadCount = await this.db.supportMessage.count({
      where: {
        conversationId,
        senderRole: 'STUDENT',
        isRead: false,
      },
    });

    return {
      id: conversation.id,
      studentId: conversation.studentId,
      studentName:
        conversation.student.profile?.fullName || conversation.student.email,
      studentEmail: conversation.student.email,
      studentAvatar: conversation.student.profile?.avatar,
      mode: conversation.mode,
      status: conversation.status,
      unreadCount,
      lastMessageTime:
        conversation.lastMessageAt?.getTime() ||
        conversation.createdAt.getTime(),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  // 7. Admin: Get messages for conversation
  async getAdminMessages(conversationId: number, query: SupportQueryDto) {
    const conversation = await this.db.supportConversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const skip = (page - 1) * limit;

    const [total, messages] = await Promise.all([
      this.db.supportMessage.count({
        where: { conversationId },
      }),
      this.db.supportMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    // Mark student messages as read by admin
    await this.db.supportMessage.updateMany({
      where: {
        conversationId,
        senderRole: 'STUDENT',
        isRead: false,
      },
      data: { isRead: true },
    });

    return {
      data: messages,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      mode: conversation.mode,
    };
  }

  // 8. Admin: Send reply to conversation
  async sendAdminMessage(
    adminId: number,
    conversationId: number,
    dto: CreateSupportMessageDto,
  ) {
    const conversation = await this.db.supportConversation.findUnique({
      where: { id: conversationId },
      include: {
        student: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (dto.clientMessageId) {
      const existing = await this.db.supportMessage.findFirst({
        where: {
          conversationId,
          clientMessageId: dto.clientMessageId,
        },
      });
      if (existing) {
        return existing;
      }
    }

    const adminUser = await this.prisma.user.findUnique({
      where: { id: adminId },
      include: { profile: true },
    });

    const adminName =
      adminUser?.profile?.fullName || adminUser?.email || 'Ban Quản Trị';

    const message = await this.db.supportMessage.create({
      data: {
        conversationId,
        senderUserId: adminId,
        senderRole: 'ADMIN',
        senderName: `${adminName} (Quản Trị Viên)`,
        content: dto.content.trim(),
        clientMessageId: dto.clientMessageId || null,
        isRead: true,
      },
    });

    await this.db.supportConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    const studentName =
      conversation.student.profile?.fullName || conversation.student.email;

    // Broadcast to student and other staff
    this.eventEmitter.emit('support.message_created', {
      conversationId,
      studentId: conversation.studentId,
      fromRole: 'ADMIN',
      targetUserId: conversation.studentId,
      message: {
        id: message.id,
        clientMessageId: message.clientMessageId,
        role: 'admin',
        content: message.content,
        senderName: message.senderName,
        timestamp: message.createdAt.getTime(),
      },
      student: {
        id: conversation.student.id,
        name: studentName,
        email: conversation.student.email,
        avatar: conversation.student.profile?.avatar,
      },
    });

    return message;
  }

  // 9. Update conversation mode (AI <-> HUMAN)
  async updateConversationMode(
    conversationId: number,
    mode: 'AI' | 'HUMAN',
    authUser: { id: number; role: string },
  ) {
    const conversation = await this.db.supportConversation.findUnique({
      where: { id: conversationId },
      include: {
        student: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                fullName: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (authUser.role === 'STUDENT' && conversation.studentId !== authUser.id) {
      throw new ForbiddenException(
        'You do not have permission to modify this conversation',
      );
    }

    const updated = await this.db.supportConversation.update({
      where: { id: conversationId },
      data: { mode },
    });

    const actor = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      include: { profile: true },
    });
    const actorName = actor?.profile?.fullName || actor?.email || 'Hệ thống';

    const sysContent =
      mode === 'HUMAN'
        ? `👨‍🏫 ${actorName} đã chuyển sang chế độ TRỰC TIẾP HỖ TRỢ. Mọi câu hỏi sẽ được phản hồi bởi thầy cô / ban quản trị!`
        : '🤖 Đã kích hoạt lại TRỢ LÝ AI. Bánh Mì Assistant sẽ tự động giải đáp thắc mắc học tập ngay tức thì! 🍞';

    await this.db.supportMessage.create({
      data: {
        conversationId,
        senderRole: 'SYSTEM',
        senderName: 'Hệ thống',
        content: sysContent,
        isRead: true,
      },
    });

    this.eventEmitter.emit('support.mode_updated', {
      conversationId,
      studentId: conversation.studentId,
      mode,
      adminName: actorName,
    });

    return updated;
  }
}
