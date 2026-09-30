import { Test, TestingModule } from '@nestjs/testing';
import { SpeakingWorkerModule } from './speaking-worker.module';
import { SpeakingProcessorService } from '../modules/speaking/speaking-processor.service';
import { SpeakingWorkerRunnerService } from './speaking-worker-runner.service';
import { EventsGateway } from '../modules/events/events.gateway';
import { SpeakingEventsSubscriberService } from '../modules/speaking/speaking-events-subscriber.service';
import { SpeakingReconciliationScheduler } from '../modules/speaking/speaking-reconciliation.scheduler';
import { SpeakingWorkerService } from '../modules/speaking/speaking-worker.service';
import { SpeakingController } from '../modules/speaking/speaking.controller';
import { UploadController } from '../modules/upload/upload.controller';
import { AiController } from '../modules/ai/ai.controller';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../modules/upload/upload.service';
import { AiService } from '../modules/ai/ai.service';

describe('SpeakingWorkerModule (Worker Isolation)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [SpeakingWorkerModule],
    })
      .overrideProvider(SpeakingWorkerRunnerService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(UploadService)
      .useValue({})
      .overrideProvider(AiService)
      .useValue({})
      .compile();
  });

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('must NOT define or instantiate any HTTP controllers', () => {
    const controllers =
      Reflect.getMetadata('controllers', SpeakingWorkerModule) || [];
    expect(controllers).toEqual([]);

    expect(() => moduleRef.get(SpeakingController)).toThrow();
    expect(() => moduleRef.get(UploadController)).toThrow();
    expect(() => moduleRef.get(AiController)).toThrow();
  });

  it('must NOT instantiate runtime API singletons (EventsGateway, Schedulers, Subscribers, Legacy Worker)', () => {
    expect(() => moduleRef.get(EventsGateway)).toThrow();
    expect(() => moduleRef.get(SpeakingEventsSubscriberService)).toThrow();
    expect(() => moduleRef.get(SpeakingReconciliationScheduler)).toThrow();
    expect(() => moduleRef.get(SpeakingWorkerService)).toThrow();
  });

  it('must provide SpeakingProcessorService and SpeakingWorkerRunnerService', () => {
    const processor = moduleRef.get(SpeakingProcessorService);
    const runner = moduleRef.get(SpeakingWorkerRunnerService);
    expect(processor).toBeDefined();
    expect(runner).toBeDefined();
  });
});
