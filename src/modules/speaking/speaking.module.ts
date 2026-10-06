import { Module } from '@nestjs/common';
import { SpeakingController } from './speaking.controller';
import { SpeakingService } from './speaking.service';
import { SpeakingProcessingModule } from './speaking-processing.module';
import { EventsModule } from '../events/events.module';
import { SpeakingWorkerService } from './speaking-worker.service';
import { SpeakingReconciliationScheduler } from './speaking-reconciliation.scheduler';
import { SpeakingEventsSubscriberService } from './speaking-events-subscriber.service';
import { SubscriptionModule } from '../subscription/subscription.module';
import { SpeakingContentAccessService } from './speaking-content-access.service';

@Module({
  imports: [SpeakingProcessingModule, EventsModule, SubscriptionModule],
  controllers: [SpeakingController],
  providers: [
    SpeakingService,
    SpeakingWorkerService,
    SpeakingReconciliationScheduler,
    SpeakingEventsSubscriberService,
    SpeakingContentAccessService,
  ],
  exports: [SpeakingService, SpeakingWorkerService, SpeakingProcessingModule],
})
export class SpeakingModule {}
