import { Test, TestingModule } from '@nestjs/testing';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';

describe('WritingController', () => {
  let controller: WritingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WritingController],
      providers: [{ provide: WritingService, useValue: {} }],
    }).compile();

    controller = module.get<WritingController>(WritingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
