import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { EmailService } from '../src/common/email/email.service';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

describe('AuthModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let emailService: EmailService;
  let redis: Redis;
  let capturedOtp = '';
  let accessToken = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    emailService = app.get<EmailService>(EmailService);
    redis = app.get<Redis>(getRedisConnectionToken());

    jest
      .spyOn(emailService, 'sendRegistrationOtp')
      .mockImplementation((_to: string, otp: string) => {
        capturedOtp = otp;
        return Promise.resolve();
      });

    // Dọn dẹp dữ liệu test cũ nếu có
    await prisma.user.deleteMany({
      where: { email: 'test_e2e@breadtrans.com' },
    });
    if (redis) {
      await redis.del('register:pending:test_e2e@breadtrans.com');
      await redis.del('register:otp:test_e2e@breadtrans.com');
      await redis.del('register:otp:attempts:test_e2e@breadtrans.com');
    }
  });

  afterAll(async () => {
    // Dọn dẹp dữ liệu test để không ảnh hưởng lần chạy sau
    await prisma.user.deleteMany({
      where: { email: 'test_e2e@breadtrans.com' },
    });
    if (redis) {
      await redis.del('register:pending:test_e2e@breadtrans.com');
      await redis.del('register:otp:test_e2e@breadtrans.com');
      await redis.del('register:otp:attempts:test_e2e@breadtrans.com');
      await redis.quit();
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('/auth/register (POST) & /auth/register/verify (POST)', () => {
    it('should initiate registration and send OTP', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test_e2e@breadtrans.com',
          password: 'password123',
          fullName: 'Test E2E User',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(capturedOtp).toMatch(/^\d{6}$/);
        });
    });

    it('should reject verification with invalid OTP', () => {
      return request(app.getHttpServer())
        .post('/auth/register/verify')
        .send({
          email: 'test_e2e@breadtrans.com',
          otp: '000000',
        })
        .expect(401);
    });

    it('should complete registration with valid OTP', () => {
      return request(app.getHttpServer())
        .post('/auth/register/verify')
        .send({
          email: 'test_e2e@breadtrans.com',
          otp: capturedOtp,
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.email).toEqual('test_e2e@breadtrans.com');
          expect(res.body).not.toHaveProperty('password');
        });
    });

    it('should return 409 Conflict if email already exists', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test_e2e@breadtrans.com', // same email now in DB
          password: 'password123',
          fullName: 'Test E2E User',
        })
        .expect(409);
    });
  });

  describe('/auth/login (POST)', () => {
    it('should login and return access_token', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test_e2e@breadtrans.com',
          password: 'password123',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('access_token');
          expect(res.body.user.email).toEqual('test_e2e@breadtrans.com');
          accessToken = res.body.access_token;
        });
    });

    it('should return 401 for wrong password', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'test_e2e@breadtrans.com',
          password: 'wrong_password',
        })
        .expect(401);
    });
  });

  describe('/auth/logout (POST)', () => {
    it('should logout successfully with valid bearer token', () => {
      return request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
        });
    });
  });
});
