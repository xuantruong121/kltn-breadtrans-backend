import { Test, TestingModule } from '@nestjs/testing';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiRateLimitGuard } from '../../common/guards/ai-rate-limit.guard';

describe('WritingController', () => {
  let controller: WritingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WritingController],
      providers: [{ provide: WritingService, useValue: {} }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AiRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WritingController>(WritingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
