import { Module } from '@nestjs/common';
import { SpeakingController } from './speaking.controller';
import { SpeakingService } from './speaking.service';
import { SpeakingProcessingModule } from './speaking-processing.module';
import { EventsModule } from '../events/events.module';
import { SpeakingWorkerService } from './speaking-worker.service';
import { SpeakingQueueService } from './speaking-queue.service';
import { SpeakingReconciliationScheduler } from './speaking-reconciliation.scheduler';
import { SpeakingEventsSubscriberService } from './speaking-events-subscriber.service';

@Module({
  imports: [SpeakingProcessingModule, EventsModule],
  controllers: [SpeakingController],
  providers: [
    SpeakingService,
    SpeakingWorkerService,
    SpeakingQueueService,
    SpeakingReconciliationScheduler,
    SpeakingEventsSubscriberService,
  ],
  exports: [
    SpeakingService,
    SpeakingWorkerService,
    SpeakingQueueService,
    SpeakingProcessingModule,
  ],
})
export class SpeakingModule {}
