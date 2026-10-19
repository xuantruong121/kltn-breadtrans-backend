import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiGeneratorController } from './ai-generator.controller';
import { AiGeneratorService } from './ai-generator.service';
import { AdminContextualAiController } from './admin-contextual-ai.controller';
import { GeminiEvaluatorStrategy } from './strategies/gemini-evaluator.strategy';
import { AI_EVALUATOR_TOKEN } from './strategies/ai-evaluator.interface';
import { UploadModule } from '../upload/upload.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SpeakingCategoryService } from '../content/speaking-category.service';

@Module({
  imports: [UploadModule, PrismaModule],
  controllers: [
    AiController,
    AiGeneratorController,
    AdminContextualAiController,
  ],
  providers: [
    AiService,
    AiGeneratorService,
    SpeakingCategoryService,
    {
      provide: AI_EVALUATOR_TOKEN,
      useClass: GeminiEvaluatorStrategy,
    },
  ],
  exports: [AiService, AiGeneratorService],
})
export class AiModule {}
