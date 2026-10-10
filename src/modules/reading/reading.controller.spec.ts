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
            getExercises: jest.fn(),
            getTopicsByCategory: jest.fn(),
            getTopicDetails: jest.fn(),
            getQuizTheory: jest.fn(),
            getTracking: jest.fn(),
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

  it('exposes the exercise-level learner catalog contract', async () => {
    const service = controller['readingService'] as unknown as {
      getExercises: jest.Mock;
    };
    service.getExercises.mockResolvedValue([{ quizId: 2 }]);

    await expect(
      controller.getExercises({ user: { id: 7, role: 'STUDENT' } }),
    ).resolves.toEqual([{ quizId: 2 }]);
    expect(service.getExercises).toHaveBeenCalledWith(7, 'STUDENT');
  });
});
