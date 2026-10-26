import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DiagnosticController } from './diagnostic.controller';
import { DiagnosticService } from './diagnostic.service';
import { DiagnosticSpeakingService } from './diagnostic-speaking.service';
import { AiModule } from '../ai/ai.module';
import { UploadModule } from '../upload/upload.module';
import { DiagnosticSpeakingAudioNormalizer } from './diagnostic-speaking-audio-normalizer';
import { DiagnosticWritingService } from './diagnostic-writing.service';
import { GamificationModule } from '../gamification/gamification.module';
import { AiService } from '../ai/ai.service';
import { DIAGNOSTIC_RUBRIC_GRADER } from './diagnostic-productive';
import { selectDiagnosticRubricGrader } from './diagnostic-rubric-grader';
import { DiagnosticAdviceCatalogService } from './diagnostic-advice-catalog.service';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    UploadModule,
    GamificationModule,
    SubscriptionModule,
  ],
  controllers: [DiagnosticController],
  providers: [
    DiagnosticService,
    DiagnosticSpeakingService,
    DiagnosticWritingService,
    DiagnosticAdviceCatalogService,
    DiagnosticSpeakingAudioNormalizer,
    {
      provide: DIAGNOSTIC_RUBRIC_GRADER,
      useFactory: (aiService: AiService) =>
        selectDiagnosticRubricGrader(aiService),
      inject: [AiService],
    },
  ],
  exports: [DiagnosticSpeakingService],
})
export class DiagnosticModule {}
