import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

import { PrismaService } from '../src/prisma/prisma.service';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    try {
      const redis = app.get<Redis>(getRedisConnectionToken(), { strict: false });
      if (redis) {
        await redis.quit();
      }
    } catch {
      // Ignore if redis is not present
    }

    try {
      const prisma = app.get<PrismaService>(PrismaService, { strict: false });
      if (prisma) {
        await prisma.$disconnect();
      }
    } catch {
      // Ignore if prisma is not present
    }

    await app.close();
  });
});
