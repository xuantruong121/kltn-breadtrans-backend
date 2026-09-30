import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { EventsGateway } from './events.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { SupportService } from '../support/support.service';

describe('EventsGateway Socket.IO Room Authentication & Isolation', () => {
  let app: INestApplication;
  let gateway: EventsGateway;
  let jwtService: JwtService;
  let serverPort: number;
  let mockPrisma: any;
  let mockRedis: any;
  let mockSupportService: any;

  const validSecret =
    'test-jwt-secret-for-events-gateway-integration-testing-key-12345';
  process.env.JWT_SECRET = validSecret;

  beforeAll(async () => {
    mockPrisma = {
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 101) {
            return Promise.resolve({
              id: 101,
              email: 'usera@example.com',
              role: 'STUDENT',
              profile: null,
            });
          }
          if (where.id === 102) {
            return Promise.resolve({
              id: 102,
              email: 'userb@example.com',
              role: 'STUDENT',
              profile: null,
            });
          }
          return Promise.resolve(null);
        }),
      },
    };

    mockRedis = {
      get: jest.fn().mockResolvedValue(null), // no token in denylist, no logged_out_at
    };

    mockSupportService = {
      getOrCreateStudentConversation: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        JwtService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: 'default_IORedisModuleConnectionToken',
          useValue: mockRedis,
        },
        { provide: SupportService, useValue: mockSupportService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0); // Random free port

    gateway = moduleFixture.get<EventsGateway>(EventsGateway);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    const httpServer = app.getHttpServer() as import('node:http').Server;
    const address = httpServer.address();
    serverPort =
      typeof address === 'object' && address !== null ? address.port : 0;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const createValidToken = (userId: number, deviceId = `device-${userId}`) => {
    return jwtService.sign(
      {
        sub: userId,
        type: 'access',
        deviceId,
        iat: Math.floor(Date.now() / 1000),
      },
      { secret: validSecret },
    );
  };

  it('1. Connects as User A and User B, authenticates via JWT, and joins private rooms user_<id>', async () => {
    const tokenA = createValidToken(101);
    const tokenB = createValidToken(102);

    const clientA: ClientSocket = io(`http://localhost:${serverPort}`, {
      auth: { token: tokenA },
      transports: ['websocket'],
    });

    const clientB: ClientSocket = io(`http://localhost:${serverPort}`, {
      auth: { token: tokenB },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((res) => clientA.on('connect', () => res())),
      new Promise<void>((res) => clientB.on('connect', () => res())),
    ]);

    expect(clientA.connected).toBe(true);
    expect(clientB.connected).toBe(true);

    clientA.disconnect();
    clientB.disconnect();
  });

  it('2. Publishing speaking.completed for User A delivers ONLY to User A; User B receives nothing', async () => {
    const tokenA = createValidToken(101);
    const tokenB = createValidToken(102);

    const clientA: ClientSocket = io(`http://localhost:${serverPort}`, {
      auth: { token: tokenA },
      transports: ['websocket'],
    });

    const clientB: ClientSocket = io(`http://localhost:${serverPort}`, {
      auth: { token: tokenB },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((res) => clientA.on('connect', () => res())),
      new Promise<void>((res) => clientB.on('connect', () => res())),
    ]);

    const receivedA: any[] = [];
    const receivedB: any[] = [];

    clientA.on('speaking.completed', (data) => receivedA.push(data));
    clientB.on('speaking.completed', (data) => receivedB.push(data));

    // Simulate SpeakingEventsSubscriber emitting event to User A's private room
    gateway.server.to('user_101').emit('speaking.completed', {
      submissionId: 999,
      traceId: 'trace-test-priv',
      status: 'COMPLETED',
    });

    // Wait for network propagation
    await new Promise((res) => setTimeout(res, 200));

    expect(receivedA.length).toBe(1);
    expect(receivedA[0]).toEqual({
      submissionId: 999,
      traceId: 'trace-test-priv',
      status: 'COMPLETED',
    });

    // User B must receive ZERO events
    expect(receivedB.length).toBe(0);

    clientA.disconnect();
    clientB.disconnect();
  });

  it('3. Reconnect re-authenticates and successfully rejoins the user room', async () => {
    const tokenA = createValidToken(101);

    const clientA: ClientSocket = io(`http://localhost:${serverPort}`, {
      auth: { token: tokenA },
      transports: ['websocket'],
    });

    await new Promise<void>((res) => clientA.on('connect', () => res()));
    expect(clientA.connected).toBe(true);

    // Disconnect and reconnect
    clientA.disconnect();
    expect(clientA.connected).toBe(false);

    clientA.connect();
    await new Promise<void>((res) => clientA.on('connect', () => res()));
    expect(clientA.connected).toBe(true);

    const received: any[] = [];
    clientA.on('speaking.completed', (d) => received.push(d));

    gateway.server.to('user_101').emit('speaking.completed', {
      submissionId: 1000,
      traceId: 'trace-reconnect',
      status: 'COMPLETED',
    });

    await new Promise((res) => setTimeout(res, 200));

    expect(received.length).toBe(1);
    expect(received[0].submissionId).toBe(1000);

    clientA.disconnect();
  });

  it('4. Connection with invalid/missing token is rejected with auth:error', async () => {
    const clientInvalid: ClientSocket = io(`http://localhost:${serverPort}`, {
      auth: { token: 'invalid-garbage-token' },
      transports: ['websocket'],
    });

    const errorPromise = new Promise((resolve) => {
      clientInvalid.on('auth:error', resolve);
      clientInvalid.on('connect_error', resolve);
    });

    const err = await errorPromise;
    expect(err).toBeDefined();

    clientInvalid.disconnect();
  });
});
