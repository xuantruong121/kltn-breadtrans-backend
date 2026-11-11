import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { SupportQueryDto } from './dto/support-query.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { TutorService } from '../ai/tutor.service';
import { TUTOR_HISTORY_TURNS, type TutorTurn } from '../ai/tutor-prompt.logic';

export const SUPPORT_AI_NAME = 'Trợ Lý Bánh Mì';

@Injectable()
export class SupportService {
  private readonly logger = new Logger('SupportService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly tutor?: TutorService,
  ) {}

  /**
   * The tutor's answer to a learner message in a conversation on AI mode,
   * written by the server: the browser never supplies what "the AI" said.
   */
  private async replyAsTutor(
    conversationId: number,
    studentId: number,
    studentMessageId: number,
    content: string,
  ) {
    if (!this.tutor) return null;
    const earlier = await this.db.supportMessage.findMany({
      where: {
        conversationId,
        id: { lt: studentMessageId },
        senderRole: { in: ['STUDENT', 'AI'] },
      },
      orderBy: { id: 'desc' },
      take: TUTOR_HISTORY_TURNS,
      select: { senderRole: true, content: true },
    });
    const history: TutorTurn[] = earlier.reverse().map((m) => ({
      role: m.senderRole === 'AI' ? 'assistant' : 'user',
      content: m.content,
    }));
    const { reply, quota, limited } = await this.tutor.reply(studentId, {
      message: content,
      history,
    });
    const saved = await this.createAiMessage(
      conversationId,
      reply,
      `ai-for-${studentMessageId}`,
    );
    return saved ? { ...saved, quota, limited } : null;
  }

  // Helper access to support models typed via PrismaService
  private get db(): PrismaService {
    return this.prisma;
  }

  private async notifyAdminsAboutStudentMessage(
    conversationId: number,
    studentName: string,
    preview: string,
  ) {
    const admins = await this.db.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        this.notificationsService.createNotification({
          userId: admin.id,
          type: 'NEW_MESSAGE',
          title: 'Tin nhắn mới từ học viên',
          body: `${studentName}: ${preview}`,
          url: `/admin/messages?conversation=${conversationId}`,
        }),
      ),
    );
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
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    }

    if (conversation.studentId !== studentId) {
      throw new ForbiddenException(
        'Bạn không có quyền xem cuộc trò chuyện này.',
      );
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const beforeId = query.beforeId ? Number(query.beforeId) : undefined;

    let messages: any[] = [];
    let hasMore = false;
    let total = 0;

    if (beforeId !== undefined) {
      const whereClause: any = { conversationId, id: { lt: beforeId } };

      const [totalCount, fetchedDesc] = await Promise.all([
        this.db.supportMessage.count({ where: { conversationId } }),
        this.db.supportMessage.findMany({
          where: whereClause,
          orderBy: { id: 'desc' },
          take: limit,
        }),
      ]);
      total = totalCount;
      messages = fetchedDesc.reverse();
      const oldestId = messages.length > 0 ? messages[0].id : null;
      if (oldestId) {
        const olderCount = await this.db.supportMessage.count({
          where: { conversationId, id: { lt: oldestId } },
        });
        hasMore = olderCount > 0;
      }
    } else {
      const skip = (page - 1) * limit;
      const [totalCount, legacyMessages] = await Promise.all([
        this.db.supportMessage.count({ where: { conversationId } }),
        this.db.supportMessage.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          skip,
          take: limit,
        }),
      ]);
      total = totalCount;
      messages = legacyMessages;
      hasMore = skip + messages.length < total;
    }

    // Mark admin messages as read
    await this.db.supportMessage.updateMany({
      where: {
        conversationId,
        senderRole: 'ADMIN',
        isRead: false,
      },
      data: { isRead: true },
    });
    await this.notificationsService.markMessageNotificationsRead(
      studentId,
      `/messages`,
    );

    return {
      data: messages,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      mode: conversation.mode,
      hasMore,
    };
  }

  async getStudentUnreadCount(studentId: number) {
    const count = await this.db.supportMessage.count({
      where: {
        senderRole: 'ADMIN',
        isRead: false,
        conversation: { studentId },
      },
    });
    return { count };
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
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    }

    if (conversation.studentId !== studentId) {
      throw new ForbiddenException(
        'Bạn không có quyền gửi tin trong cuộc trò chuyện này.',
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
        return { ...existing, aiReply: null };
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

    // On AI mode the tutor answers and nobody is waiting on an admin; on
    // HUMAN mode the admins are told a learner wrote.
    if (conversation.mode === 'AI') {
      const aiReply = await this.replyAsTutor(
        conversationId,
        studentId,
        message.id,
        message.content,
      ).catch((error) => {
        this.logger.error(`Tutor reply failed: ${String(error)}`);
        return null;
      });
      return { ...message, aiReply };
    }

    await this.notifyAdminsAboutStudentMessage(
      conversationId,
      studentName,
      message.content.slice(0, 140),
    );

    return { ...message, aiReply: null };
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
        senderName: SUPPORT_AI_NAME,
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

    const search = query.search?.trim();
    const where: any = {
      ...(search
        ? {
            student: {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                {
                  profile: {
                    fullName: { contains: search, mode: 'insensitive' },
                  },
                },
              ],
            },
          }
        : {}),
      ...(query.unreadOnly
        ? {
            messages: {
              some: { senderRole: 'STUDENT', isRead: false },
            },
          }
        : {}),
    };

    const [total, conversations] = await Promise.all([
      this.db.supportConversation.count({ where }),
      this.db.supportConversation.findMany({
        where,
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

  async getAdminUnreadCount() {
    const count = await this.db.supportMessage.count({
      where: { senderRole: 'STUDENT', isRead: false },
    });
    return { count };
  }

  async searchLearners(search?: string) {
    const keyword = search?.trim();
    if (!keyword || keyword.length < 2) return { data: [] };

    const learners = await this.db.user.findMany({
      where: {
        role: Role.STUDENT,
        OR: [
          { email: { contains: keyword, mode: 'insensitive' } },
          {
            profile: {
              fullName: { contains: keyword, mode: 'insensitive' },
            },
          },
        ],
      },
      select: {
        id: true,
        email: true,
        profile: { select: { fullName: true, avatar: true } },
        supportConversation: { select: { id: true } },
      },
      take: 12,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: learners.map((learner) => ({
        id: learner.id,
        name: learner.profile?.fullName || learner.email,
        email: learner.email,
        avatar: learner.profile?.avatar || null,
        conversationId: learner.supportConversation?.id || null,
      })),
    };
  }

  async startAdminConversation(studentId: number) {
    const learner = await this.db.user.findFirst({
      where: { id: studentId, role: Role.STUDENT },
      select: { id: true },
    });
    if (!learner) throw new NotFoundException('Không tìm thấy học viên.');
    return this.getOrCreateStudentConversation(learner.id);
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
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
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
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const beforeId = query.beforeId ? Number(query.beforeId) : undefined;

    let messages: any[] = [];
    let hasMore = false;
    let total = 0;

    if (beforeId !== undefined) {
      const whereClause: any = { conversationId, id: { lt: beforeId } };

      const [totalCount, fetchedDesc] = await Promise.all([
        this.db.supportMessage.count({ where: { conversationId } }),
        this.db.supportMessage.findMany({
          where: whereClause,
          orderBy: { id: 'desc' },
          take: limit,
        }),
      ]);
      total = totalCount;
      messages = fetchedDesc.reverse();
      const oldestId = messages.length > 0 ? messages[0].id : null;
      if (oldestId) {
        const olderCount = await this.db.supportMessage.count({
          where: { conversationId, id: { lt: oldestId } },
        });
        hasMore = olderCount > 0;
      }
    } else {
      const skip = (page - 1) * limit;
      const [totalCount, legacyMessages] = await Promise.all([
        this.db.supportMessage.count({ where: { conversationId } }),
        this.db.supportMessage.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          skip,
          take: limit,
        }),
      ]);
      total = totalCount;
      messages = legacyMessages;
      hasMore = skip + messages.length < total;
    }

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
      hasMore,
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
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
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
        isRead: false,
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

    // The learner sees an admin message as a number on the floating pet
    // (unread count) and a toast, not as an inbox notification.

    // An admin who answers takes the conversation over, so the tutor and the
    // admin never both reply to the next message.
    if (conversation.mode === 'AI') {
      await this.updateConversationMode(conversationId, 'HUMAN', {
        id: adminId,
        role: Role.ADMIN,
      });
    }

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
      throw new NotFoundException('Không tìm thấy cuộc trò chuyện.');
    }

    if (authUser.role === 'STUDENT' && conversation.studentId !== authUser.id) {
      throw new ForbiddenException(
        'Bạn không có quyền chỉnh sửa cuộc trò chuyện này.',
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

    if (conversation.mode === mode) return updated;

    const byStudent = authUser.role === 'STUDENT';
    const sysContent =
      mode === 'HUMAN'
        ? byStudent
          ? 'Bạn đã yêu cầu trao đổi với quản trị viên. Trợ lý AI tạm dừng trả lời; quản trị viên sẽ phản hồi tại đây.'
          : 'Quản trị viên đã tham gia trò chuyện. Trợ lý AI tạm dừng trả lời.'
        : 'Trợ lý AI tiếp tục trả lời trong cuộc trò chuyện này.';

    // Both sides read the change in the thread. Admins are also told in
    // their inbox when a learner asks for a person; a learner's inbox is not
    // used for the conversation.
    if (byStudent && mode === 'HUMAN') {
      await this.notifyAdminsAboutStudentMessage(
        conversationId,
        conversation.student.profile?.fullName || conversation.student.email,
        'Học viên yêu cầu trao đổi với quản trị viên.',
      );
    }

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
      systemMessage: sysContent,
    });

    return updated;
  }
}
