import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TutorService } from '../ai/tutor.service';
import { SUPPORT_AI_NAME, SupportService } from './support.service';

/**
 * The support conversation after the messages were merged into the tutor
 * widget (owner 2026-11-11): the server writes the AI reply, an admin who
 * answers takes the conversation over, and both sides are told of a switch.
 */
describe('SupportService: tutor replies and the AI/admin switch', () => {
  const student = {
    id: 10,
    email: 'student@example.com',
    profile: { fullName: 'Student Ten', avatar: null },
  };
  const conversation = (mode: 'AI' | 'HUMAN') => ({
    id: 100,
    studentId: 10,
    mode,
    status: 'OPEN',
    student,
  });

  const prisma = {
    supportConversation: { findUnique: jest.fn(), update: jest.fn() },
    supportMessage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const events = { emit: jest.fn() };
  const notifications = { createNotification: jest.fn() };
  const tutor = { reply: jest.fn() };
  let service: SupportService;
  let nextId: number;

  beforeEach(async () => {
    jest.clearAllMocks();
    nextId = 500;
    prisma.supportMessage.findFirst.mockResolvedValue(null);
    prisma.supportMessage.findMany.mockResolvedValue([]);
    prisma.supportMessage.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: nextId++, createdAt: new Date(), ...data }),
    );
    prisma.supportConversation.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 100, studentId: 10, ...data }),
    );
    prisma.user.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'admin@breadtrans.com',
      profile: { fullName: 'Admin One' },
    });
    tutor.reply.mockResolvedValue({
      reply: 'Present perfect nối quá khứ với hiện tại.',
      quota: { limit: 10, remaining: 9 },
      limited: false,
    });
    const module = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
        { provide: NotificationsService, useValue: notifications },
        { provide: TutorService, useValue: tutor },
      ],
    }).compile();
    service = module.get(SupportService);
  });

  it('on AI mode the server asks the tutor, with the earlier turns, and stores its answer', async () => {
    prisma.supportConversation.findUnique.mockResolvedValue(conversation('AI'));
    prisma.supportMessage.findMany.mockResolvedValue([
      { senderRole: 'AI', content: 'Chào bạn.' },
      { senderRole: 'STUDENT', content: 'Chào trợ lý' },
    ]);

    const result = await service.sendStudentMessage(10, 100, {
      content: 'present perfect là gì?',
      clientMessageId: 'c-1',
    });

    expect(tutor.reply).toHaveBeenCalledWith(10, {
      message: 'present perfect là gì?',
      history: [
        { role: 'user', content: 'Chào trợ lý' },
        { role: 'assistant', content: 'Chào bạn.' },
      ],
    });
    expect(result.aiReply).toMatchObject({
      senderRole: 'AI',
      senderName: SUPPORT_AI_NAME,
      content: 'Present perfect nối quá khứ với hiện tại.',
      quota: { limit: 10, remaining: 9 },
    });
    expect(result.aiReply?.clientMessageId).toBe(`ai-for-${result.id}`);
    expect(events.emit).toHaveBeenCalledWith(
      'support.message_created',
      expect.objectContaining({ fromRole: 'AI' }),
    );
    // Nobody is waiting on an admin while the tutor answers.
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('on HUMAN mode the tutor stays silent and the admins are told', async () => {
    prisma.supportConversation.findUnique.mockResolvedValue(
      conversation('HUMAN'),
    );

    const result = await service.sendStudentMessage(10, 100, {
      content: 'Tôi cần hỗ trợ thanh toán',
    });

    expect(tutor.reply).not.toHaveBeenCalled();
    expect(result.aiReply).toBeNull();
    expect(notifications.createNotification).toHaveBeenCalledTimes(2);
  });

  it('keeps the learner message when the tutor fails', async () => {
    prisma.supportConversation.findUnique.mockResolvedValue(conversation('AI'));
    tutor.reply.mockRejectedValue(new Error('redis down'));

    const result = await service.sendStudentMessage(10, 100, {
      content: 'hello',
    });

    expect(result.content).toBe('hello');
    expect(result.aiReply).toBeNull();
  });

  it('an admin who answers on AI mode takes the conversation over', async () => {
    prisma.supportConversation.findUnique.mockResolvedValue(conversation('AI'));

    await service.sendAdminMessage(1, 100, { content: 'Mình hỗ trợ bạn nhé.' });

    expect(prisma.supportConversation.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { mode: 'HUMAN' },
    });
    expect(events.emit).toHaveBeenCalledWith(
      'support.mode_updated',
      expect.objectContaining({ conversationId: 100, mode: 'HUMAN' }),
    );
    const system = prisma.supportMessage.create.mock.calls
      .map(([arg]) => arg.data)
      .find((d) => d.senderRole === 'SYSTEM');
    expect(system.content).toBe(
      'Quản trị viên đã tham gia trò chuyện. Trợ lý AI tạm dừng trả lời.',
    );
  });

  it('an admin who answers on HUMAN mode changes nothing about the mode', async () => {
    prisma.supportConversation.findUnique.mockResolvedValue(
      conversation('HUMAN'),
    );

    await service.sendAdminMessage(1, 100, { content: 'Đã xử lý.' });

    expect(events.emit).not.toHaveBeenCalledWith(
      'support.mode_updated',
      expect.anything(),
    );
  });

  it('keeps the conversation out of the learner inbox: no notice for an admin message or switch', async () => {
    prisma.supportConversation.findUnique.mockResolvedValue(conversation('AI'));
    await service.sendAdminMessage(1, 100, { content: 'Mình hỗ trợ bạn nhé.' });
    prisma.supportConversation.findUnique.mockResolvedValue(
      conversation('HUMAN'),
    );
    await service.updateConversationMode(100, 'AI', { id: 1, role: 'ADMIN' });

    expect(notifications.createNotification).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      'support.mode_updated',
      expect.objectContaining({
        mode: 'AI',
        systemMessage: 'Trợ lý AI tiếp tục trả lời trong cuộc trò chuyện này.',
      }),
    );
  });

  it('tells the admins when the learner asks for a person', async () => {
    prisma.supportConversation.findUnique.mockResolvedValue(conversation('AI'));

    await service.updateConversationMode(100, 'HUMAN', {
      id: 10,
      role: 'STUDENT',
    });

    const sent = notifications.createNotification.mock.calls.map(([n]) => n);
    expect(sent.map((n) => n.userId).sort()).toEqual([1, 2]);
    expect(sent[0].body).toContain('yêu cầu trao đổi với quản trị viên');
  });

  it('writes no system line and no notice when the mode does not change', async () => {
    prisma.supportConversation.findUnique.mockResolvedValue(conversation('AI'));

    await service.updateConversationMode(100, 'AI', { id: 1, role: 'ADMIN' });

    expect(prisma.supportMessage.create).not.toHaveBeenCalled();
    expect(notifications.createNotification).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});
