import { Test, TestingModule } from '@nestjs/testing';
import { VocabController } from './vocab.controller';
import { VocabService } from './vocab.service';

describe('VocabController', () => {
  let controller: VocabController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VocabController],
      providers: [{ provide: VocabService, useValue: {} }],
    }).compile();

    controller = module.get<VocabController>(VocabController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
