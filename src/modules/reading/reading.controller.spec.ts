import { Test, TestingModule } from '@nestjs/testing';
import { ReadingController } from './reading.controller';
import { ReadingService } from './reading.service';

describe('ReadingController', () => {
  let controller: ReadingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReadingController],
      providers: [
        {
          provide: ReadingService,
          useValue: {
            getTopicsByCategory: jest.fn(),
            getTopicDetails: jest.fn(),
            getQuizTheory: jest.fn(),
            getBilingualProgress: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ReadingController>(ReadingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
