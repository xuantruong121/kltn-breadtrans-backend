import { Test, TestingModule } from '@nestjs/testing';
import { EventsGateway } from './events.gateway';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';

describe('EventsGateway Security & Authentication Tests', () => {
  let gateway: EventsGateway;
  let jwtService: JwtService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          email: 'student@example.com',
          role: 'STUDENT',
          profile: { fullName: 'Student', avatar: null },
        }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: getRedisConnectionToken('default'),
          useValue: { get: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
    jwtService = module.get<JwtService>(JwtService);

    // Mock server object on gateway
    (gateway as any).server = {
      to: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
      emit: jest.fn(),
    };
  });

  it('should reject connection when token is missing', async () => {
    const mockSocket: Partial<Socket> = {
      id: 'socket-1',
      handshake: {
        auth: {},
        headers: {},
      } as any,
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(mockSocket as Socket);

    expect(mockSocket.emit).toHaveBeenCalledWith('auth:error', {
      message: 'Authentication token required',
    });
    expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
  });

  it('should reject connection when token is invalid', async () => {
    const mockSocket: Partial<Socket> = {
      id: 'socket-2',
      handshake: {
        auth: { token: 'invalid.token.here' },
        headers: {},
      } as any,
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    (jwtService.verify as jest.Mock).mockImplementation(() => {
      throw new Error('JsonWebTokenError: invalid signature');
    });

    await gateway.handleConnection(mockSocket as Socket);

    expect(mockSocket.emit).toHaveBeenCalledWith('auth:error', {
      message: 'Invalid or expired authentication token',
    });
    expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
  });

  it('should authenticate valid STUDENT and only join user room', async () => {
    const mockSocket: Partial<Socket> = {
      id: 'socket-3',
      handshake: {
        auth: { token: 'valid.student.token' },
        headers: {},
      } as any,
      data: {},
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    (jwtService.verify as jest.Mock).mockReturnValue({
      sub: 10,
      email: 'student@example.com',
      role: 'STUDENT',
      type: 'access',
      deviceId: 'device-10',
    });

    await gateway.handleConnection(mockSocket as Socket);

    expect(mockSocket.disconnect).not.toHaveBeenCalled();
    expect(mockSocket.data.user).toEqual({
      userId: 10,
      email: 'student@example.com',
      role: 'STUDENT',
      deviceId: 'device-10',
      profile: { fullName: 'Student', avatar: null },
    });
    expect(mockSocket.join).toHaveBeenCalledWith('user_10');
    expect(mockSocket.join).not.toHaveBeenCalledWith('admins');
    expect(mockSocket.join).not.toHaveBeenCalledWith('support_staff');
  });

  it('should authenticate valid ADMIN and join both admins and support_staff', async () => {
    const mockSocket: Partial<Socket> = {
      id: 'socket-4',
      handshake: {
        auth: { token: 'valid.admin.token' },
        headers: {},
      } as any,
      data: {},
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    (jwtService.verify as jest.Mock).mockReturnValue({
      sub: 1,
      email: 'admin@breadtrans.com',
      role: 'ADMIN',
      type: 'access',
      deviceId: 'device-1',
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'admin@breadtrans.com',
      role: 'ADMIN',
      profile: { fullName: 'Admin', avatar: null },
    });

    await gateway.handleConnection(mockSocket as Socket);

    expect(mockSocket.join).toHaveBeenCalledWith('user_1');
    expect(mockSocket.join).toHaveBeenCalledWith('admins');
    expect(mockSocket.join).toHaveBeenCalledWith('support_staff');
  });

  it('should authenticate valid TEACHER and join support_staff but NOT admins', async () => {
    const mockSocket: Partial<Socket> = {
      id: 'socket-5',
      handshake: {
        auth: { token: 'valid.teacher.token' },
        headers: {},
      } as any,
      data: {},
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    (jwtService.verify as jest.Mock).mockReturnValue({
      sub: 2,
      email: 'teacher@breadtrans.com',
      role: 'TEACHER',
      type: 'access',
      deviceId: 'device-2',
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 2,
      email: 'teacher@breadtrans.com',
      role: 'TEACHER',
      profile: { fullName: 'Teacher', avatar: null },
    });

    await gateway.handleConnection(mockSocket as Socket);

    expect(mockSocket.join).toHaveBeenCalledWith('user_2');
    expect(mockSocket.join).toHaveBeenCalledWith('support_staff');
    expect(mockSocket.join).not.toHaveBeenCalledWith('admins');
  });

  it('should ignore client payload in joinUserRoom and enforce authenticated identity', async () => {
    const mockSocket: Partial<Socket> = {
      id: 'socket-6',
      data: {
        user: { userId: 42, email: 'student42@example.com', role: 'STUDENT' },
      },
      join: jest.fn(),
      disconnect: jest.fn(),
    };

    // Client maliciously attempts to join user_1 and role: 'ADMIN'
    await gateway.handleJoinUserRoom(mockSocket as Socket, {
      userId: 1,
      role: 'ADMIN',
    });

    expect(mockSocket.join).toHaveBeenCalledWith('user_42');
    expect(mockSocket.join).not.toHaveBeenCalledWith('user_1');
    expect(mockSocket.join).not.toHaveBeenCalledWith('admins');
    expect(mockSocket.join).not.toHaveBeenCalledWith('support_staff');
  });

  it('should reject a refresh token during socket handshake', async () => {
    const mockSocket: Partial<Socket> = {
      id: 'socket-refresh',
      handshake: { auth: { token: 'refresh-token' }, headers: {} } as any,
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    (jwtService.verify as jest.Mock).mockReturnValue({
      sub: 10,
      type: 'refresh',
      deviceId: 'device-10',
    });

    await gateway.handleConnection(mockSocket as Socket);

    expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
  });

  it('normalizes student chat identity and message role server-side', async () => {
    const emit = jest.fn();
    const mockSocket: Partial<Socket> = {
      id: 'socket-chat',
      data: {
        user: {
          userId: 10,
          email: 'student@example.com',
          role: 'STUDENT',
          profile: { fullName: 'Student', avatar: null },
        },
      },
      to: jest.fn().mockReturnValue({ emit }),
    };
    await gateway.handleChatMessage(mockSocket as Socket, {
      studentId: 'student_999',
      studentName: 'Forged Name',
      message: { role: 'admin', content: 'hello' },
      fromRole: 'ADMIN',
    } as any);

    const supportEmit = ((gateway as any).server.to as jest.Mock).mock.results[0]
      .value.emit as jest.Mock;
    const payload = supportEmit.mock.calls[0][1];
    expect(payload.studentId).toBe('student_10');
    expect(payload.studentName).toBe('Student');
    expect(payload.fromRole).toBe('STUDENT');
    expect(payload.message.role).toBe('user');
  });
});
