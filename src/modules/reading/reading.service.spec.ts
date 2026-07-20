import { Test, TestingModule } from '@nestjs/testing';
import { ReadingService } from './reading.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ReadingService', () => {
  let service: ReadingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadingService,
        {
          provide: PrismaService,
          useValue: {
            practiceTopic: { findMany: jest.fn(), findUnique: jest.fn() },
            quiz: { findMany: jest.fn(), findUnique: jest.fn() },
            result: { findMany: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<ReadingService>(ReadingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
