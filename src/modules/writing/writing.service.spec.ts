import { Test, TestingModule } from '@nestjs/testing';
import { WritingService } from './writing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

describe('WritingService', () => {
  let service: WritingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingService,
        { provide: PrismaService, useValue: {} },
        { provide: AiService, useValue: {} },
      ],
    }).compile();

    service = module.get<WritingService>(WritingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
