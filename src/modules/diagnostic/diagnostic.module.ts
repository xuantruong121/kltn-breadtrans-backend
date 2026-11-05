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
import { QuizModule } from '../quiz/quiz.module';
import { SpeakingModule } from '../speaking/speaking.module';
import { LearningPathModule } from '../learning-path/learning-path.module';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    UploadModule,
    GamificationModule,
    SubscriptionModule,
    // Advice links use the item pages' own access decision (plan and level).
    QuizModule,
    SpeakingModule,
    // Advice falls back to open practice at the learner's level.
    LearningPathModule,
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
