import { Test, TestingModule } from '@nestjs/testing';
import { SupportService } from './support.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ForbiddenException } from '@nestjs/common';

describe('SupportService', () => {
  let service: SupportService;

  const mockStudent = {
    id: 10,
    email: 'student@example.com',
    profile: {
      fullName: 'Student Ten',
      avatar: 'https://example.com/avatar.jpg',
    },
  };

  const mockAdmin = {
    id: 1,
    email: 'admin@breadtrans.com',
    profile: { fullName: 'Admin One' },
  };

  const mockConversation = {
    id: 100,
    studentId: 10,
    mode: 'AI',
    status: 'OPEN',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastMessageAt: new Date(),
    student: mockStudent,
  };

  const mockPrisma = {
    supportConversation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    supportMessage: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<SupportService>(SupportService);
  });

  describe('getOrCreateStudentConversation', () => {
    it('should return existing conversation with unread count', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue(
        mockConversation,
      );
      mockPrisma.supportMessage.count.mockResolvedValue(2);

      const result = await service.getOrCreateStudentConversation(10);

      expect(mockPrisma.supportConversation.findUnique).toHaveBeenCalledWith({
        where: { studentId: 10 },
        include: expect.any(Object),
      });
      expect(result.id).toBe(100);
      expect(result.unreadCount).toBe(2);
    });

    it('should create new conversation if not found', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue(null);
      mockPrisma.supportConversation.create.mockResolvedValue(mockConversation);
      mockPrisma.supportMessage.count.mockResolvedValue(0);

      const result = await service.getOrCreateStudentConversation(10);

      expect(mockPrisma.supportConversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          studentId: 10,
          mode: 'AI',
          status: 'OPEN',
        }),
        include: expect.any(Object),
      });
      expect(result.id).toBe(100);
      expect(result.unreadCount).toBe(0);
    });
  });

  describe('getStudentMessages', () => {
    it('should throw ForbiddenException if student does not own conversation', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue({
        id: 100,
        studentId: 999, // other student
      });

      await expect(
        service.getStudentMessages(10, 100, { page: 1, limit: 50 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return paginated messages and mark admin messages as read', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue(
        mockConversation,
      );
      mockPrisma.supportMessage.count.mockResolvedValue(1);
      mockPrisma.supportMessage.findMany.mockResolvedValue([
        {
          id: 1,
          content: 'Hello',
          senderRole: 'STUDENT',
          createdAt: new Date(),
        },
      ]);
      mockPrisma.supportMessage.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.getStudentMessages(10, 100, {
        page: 1,
        limit: 50,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockPrisma.supportMessage.updateMany).toHaveBeenCalledWith({
        where: { conversationId: 100, senderRole: 'ADMIN', isRead: false },
        data: { isRead: true },
      });
    });
  });

  describe('sendStudentMessage', () => {
    it('should throw ForbiddenException if studentId does not match conversation owner', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue({
        id: 100,
        studentId: 999, // other student
        student: mockStudent,
      });

      await expect(
        service.sendStudentMessage(10, 100, { content: 'Hack attempt' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should prevent duplicate insertion if clientMessageId matches', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue(
        mockConversation,
      );
      const existingMessage = {
        id: 50,
        conversationId: 100,
        content: 'Original',
        clientMessageId: 'client-uuid-1',
      };
      mockPrisma.supportMessage.findFirst.mockResolvedValue(existingMessage);

      const result = await service.sendStudentMessage(10, 100, {
        content: 'Original',
        clientMessageId: 'client-uuid-1',
      });

      expect(result).toBe(existingMessage);
      expect(mockPrisma.supportMessage.create).not.toHaveBeenCalled();
    });

    it('should persist student message and emit support.message_created', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue(
        mockConversation,
      );
      mockPrisma.supportMessage.findFirst.mockResolvedValue(null);
      const createdMessage = {
        id: 55,
        conversationId: 100,
        senderUserId: 10,
        senderRole: 'STUDENT',
        senderName: 'Student Ten',
        content: 'I have a question',
        clientMessageId: 'client-uuid-2',
        isRead: false,
        createdAt: new Date(),
      };
      mockPrisma.supportMessage.create.mockResolvedValue(createdMessage);
      mockPrisma.supportConversation.update.mockResolvedValue(mockConversation);

      const result = await service.sendStudentMessage(10, 100, {
        content: 'I have a question',
        clientMessageId: 'client-uuid-2',
      });

      expect(result.id).toBe(55);
      expect(mockPrisma.supportMessage.create).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'support.message_created',
        expect.objectContaining({
          conversationId: 100,
          studentId: 10,
          fromRole: 'STUDENT',
        }),
      );
    });
  });

  describe('createAiMessage', () => {
    it('should persist AI message and emit support.message_created', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue(
        mockConversation,
      );
      mockPrisma.supportMessage.findFirst.mockResolvedValue(null);
      const createdMessage = {
        id: 56,
        conversationId: 100,
        senderUserId: null,
        senderRole: 'AI',
        senderName: 'Trợ Lý Bánh Mì 🍞',
        content: 'AI response text',
        clientMessageId: 'ai-client-1',
        isRead: true,
        createdAt: new Date(),
      };
      mockPrisma.supportMessage.create.mockResolvedValue(createdMessage);
      mockPrisma.supportConversation.update.mockResolvedValue(mockConversation);

      const result = await service.createAiMessage(
        100,
        'AI response text',
        'ai-client-1',
      );

      expect(result?.id).toBe(56);
      expect(mockPrisma.supportMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversationId: 100,
          senderRole: 'AI',
          senderName: 'Trợ Lý Bánh Mì 🍞',
          content: 'AI response text',
        }),
      });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'support.message_created',
        expect.objectContaining({
          conversationId: 100,
          fromRole: 'AI',
        }),
      );
    });

    it('should prevent duplicate AI insertion if clientMessageId matches', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue(
        mockConversation,
      );
      const existing = {
        id: 56,
        content: 'AI response text',
        clientMessageId: 'ai-client-1',
      };
      mockPrisma.supportMessage.findFirst.mockResolvedValue(existing);

      const result = await service.createAiMessage(
        100,
        'AI response text',
        'ai-client-1',
      );

      expect(result).toBe(existing);
      expect(mockPrisma.supportMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('sendAdminMessage', () => {
    it('should persist admin message and emit support.message_created', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue(
        mockConversation,
      );
      mockPrisma.supportMessage.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(mockAdmin);
      const createdMessage = {
        id: 60,
        conversationId: 100,
        senderUserId: 1,
        senderRole: 'ADMIN',
        senderName: 'Admin One (Quản Trị Viên)',
        content: 'Here is the answer',
        isRead: true,
        createdAt: new Date(),
      };
      mockPrisma.supportMessage.create.mockResolvedValue(createdMessage);
      mockPrisma.supportConversation.update.mockResolvedValue(mockConversation);

      const result = await service.sendAdminMessage(1, 100, {
        content: 'Here is the answer',
      });

      expect(result.id).toBe(60);
      expect(mockPrisma.supportMessage.create).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'support.message_created',
        expect.objectContaining({
          conversationId: 100,
          fromRole: 'ADMIN',
        }),
      );
    });
  });

  describe('updateConversationMode', () => {
    it('should update mode to HUMAN and record system message', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue(
        mockConversation,
      );
      mockPrisma.supportConversation.update.mockResolvedValue({
        ...mockConversation,
        mode: 'HUMAN',
      });
      mockPrisma.user.findUnique.mockResolvedValue(mockAdmin);
      mockPrisma.supportMessage.create.mockResolvedValue({ id: 70 });

      const result = await service.updateConversationMode(100, 'HUMAN', {
        id: 1,
        role: 'ADMIN',
      });

      expect(result.mode).toBe('HUMAN');
      expect(mockPrisma.supportMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversationId: 100,
          senderRole: 'SYSTEM',
        }),
      });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'support.mode_updated',
        expect.objectContaining({
          conversationId: 100,
          mode: 'HUMAN',
        }),
      );
    });

    it('should forbid student from changing other student conversation mode', async () => {
      mockPrisma.supportConversation.findUnique.mockResolvedValue({
        id: 100,
        studentId: 999,
      });

      await expect(
        service.updateConversationMode(100, 'HUMAN', {
          id: 10,
          role: 'STUDENT',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
