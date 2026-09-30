import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '../../prisma/prisma.module';
import { UploadService } from '../upload/upload.service';
import { R2Service } from '../upload/r2.service';
import { R2CleanupService } from '../upload/r2-cleanup.service';
import { AiService } from '../ai/ai.service';
import { GeminiEvaluatorStrategy } from '../ai/strategies/gemini-evaluator.strategy';
import { AI_EVALUATOR_TOKEN } from '../ai/strategies/ai-evaluator.interface';
import { SpeakingProcessorService } from './speaking-processor.service';

/**
 * Narrowly scoped processing module shared between API and standalone Worker.
 * Strictly contains NO HTTP controllers, NO WebSockets gateways, NO schedulers,
 * and NO Cron jobs.
 */
@Module({
  imports: [EventEmitterModule.forRoot(), PrismaModule],
  providers: [
    UploadService,
    R2Service,
    R2CleanupService,
    AiService,
    {
      provide: AI_EVALUATOR_TOKEN,
      useClass: GeminiEvaluatorStrategy,
    },
    SpeakingProcessorService,
  ],
  exports: [
    PrismaModule,
    UploadService,
    R2Service,
    R2CleanupService,
    AiService,
    SpeakingProcessorService,
  ],
})
export class SpeakingProcessingModule {}
