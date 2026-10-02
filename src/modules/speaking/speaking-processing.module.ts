import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-modules/ioredis';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '../../prisma/prisma.module';
import { UploadService } from '../upload/upload.service';
import { R2Service } from '../upload/r2.service';
import { R2CleanupService } from '../upload/r2-cleanup.service';
import { AiService } from '../ai/ai.service';
import { GeminiEvaluatorStrategy } from '../ai/strategies/gemini-evaluator.strategy';
import { AI_EVALUATOR_TOKEN } from '../ai/strategies/ai-evaluator.interface';
import { SpeakingProcessorService } from './speaking-processor.service';
import { SpeakingPostProcessingService } from './speaking-post-processing.service';
import { SpeakingQueueService } from './speaking-queue.service';
import { SpeakingEventPublisherService } from './speaking-event-publisher.service';
import { GamificationModule } from '../gamification/gamification.module';

/**
 * Narrowly scoped processing module shared between API and standalone Worker.
 * Strictly contains NO HTTP controllers, NO WebSockets gateways, NO schedulers,
 * and NO Cron jobs.
 */
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    PrismaModule,
    RedisModule.forRoot({
      type: 'single',
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    }),
    GamificationModule,
  ],
  providers: [
    UploadService,
    R2Service,
    R2CleanupService,
    AiService,
    {
      provide: AI_EVALUATOR_TOKEN,
      useClass: GeminiEvaluatorStrategy,
    },
    SpeakingEventPublisherService,
    SpeakingQueueService,
    SpeakingPostProcessingService,
    SpeakingProcessorService,
  ],
  exports: [
    PrismaModule,
    UploadService,
    R2Service,
    R2CleanupService,
    AiService,
    SpeakingEventPublisherService,
    SpeakingQueueService,
    SpeakingPostProcessingService,
    SpeakingProcessorService,
  ],
})
export class SpeakingProcessingModule {}
