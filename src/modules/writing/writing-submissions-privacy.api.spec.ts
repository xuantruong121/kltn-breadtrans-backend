/**
 * HTTP regression for the Writing submissions list: the real controller, the
 * real JwtAuthGuard and JwtStrategy, real signed tokens; only Prisma and Redis
 * are in-memory. Two learners each own one submission on the same exercise.
 */
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { QuizType, TopicCategory } from '@prisma/client';
import request from 'supertest';

process.env.JWT_SECRET = 'writing-privacy-api-spec-secret';

import { PrismaService } from '../../prisma/prisma.service';
import { AiRateLimitGuard } from '../../common/guards/ai-rate-limit.guard';
import { AiService } from '../ai/ai.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';

const users = [
  {
    id: 101,
    email: 'a@example.test',
    role: 'STUDENT',
    mustChangePassword: false,
  },
  {
    id: 102,
    email: 'b@example.test',
    role: 'STUDENT',
    mustChangePassword: false,
  },
];
const submissions = [
  {
    id: 1,
    quizId: 3,
    userId: 101,
    score: 9,
    aiFeedback: '{"feedback":"A only"}',
    submittedAt: new Date(1),
    results: [{ answer: 'Text of A' }],
    user: { profile: { fullName: 'Learner A' } },
  },
  {
    id: 2,
    quizId: 3,
    userId: 102,
    score: 4,
    aiFeedback: '{"feedback":"B only"}',
    submittedAt: new Date(2),
    results: [{ answer: 'Text of B' }],
    user: { profile: { fullName: 'Learner B' } },
  },
];
const prisma = {
  user: {
    findUnique: ({ where }: any) =>
      Promise.resolve(users.find((u) => u.id === where.id) ?? null),
  },
  quiz: {
    findUnique: ({ where }: any) =>
      Promise.resolve(
        where.id === 3
          ? {
              id: 3,
              type: QuizType.WRITING_PICTURE,
              publicationStatus: 'PUBLISHED',
              isPremiumContent: false,
              courseId: null,
              practiceTopic: { category: TopicCategory.WRITING_PART1 },
            }
          : null,
      ),
  },
  submission: {
    findMany: ({ where }: any) =>
      Promise.resolve(
        submissions.filter(
          (s) =>
            s.quizId === where.quizId &&
            (where.userId === undefined || s.userId === where.userId),
        ),
      ),
  },
};

describe('GET /writing/quizzes/:id/community (HTTP, privacy)', () => {
  let app: INestApplication;
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const token = (id: number) =>
    jwt.sign(
      { sub: id, type: 'access', deviceId: 'spec-device', jti: `spec-${id}` },
      { expiresIn: '5m' },
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [WritingController],
      providers: [
        WritingService,
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        { provide: AiService, useValue: {} },
        {
          provide: getRedisConnectionToken(),
          useValue: { get: () => Promise.resolve(null) },
        },
      ],
    })
      .overrideGuard(AiRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('1. anonymous request: 401 and no learner data', async () => {
    const res = await request(app.getHttpServer()).get(
      '/writing/quizzes/3/community',
    );
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/Learner|Text of|only/);
  });

  it('1b. a forged token: 401', async () => {
    const forged = new JwtService({ secret: 'wrong' }).sign({
      sub: 101,
      type: 'access',
      deviceId: 'x',
    });
    const res = await request(app.getHttpServer())
      .get('/writing/quizzes/3/community')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("2. learner A sees only A's submission, without a name", async () => {
    const res = await request(app.getHttpServer())
      .get('/writing/quizzes/3/community')
      .set('Authorization', `Bearer ${token(101)}`);
    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.id)).toEqual([1]);
    expect(JSON.stringify(res.body)).not.toMatch(/Learner|Text of B|B only/);
  });

  it("3. learner B cannot retrieve A's submission", async () => {
    const res = await request(app.getHttpServer())
      .get('/writing/quizzes/3/community')
      .set('Authorization', `Bearer ${token(102)}`);
    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.id)).toEqual([2]);
    expect(JSON.stringify(res.body)).not.toMatch(/Text of A|A only|Learner A/);
  });

  it('4. invalid quiz ids: 404 for an unknown id, 400 for a non-number', async () => {
    const auth = { Authorization: `Bearer ${token(101)}` };
    expect(
      (
        await request(app.getHttpServer())
          .get('/writing/quizzes/999/community')
          .set(auth)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .get('/writing/quizzes/abc/community')
          .set(auth)
      ).status,
    ).toBe(400);
  });
});
