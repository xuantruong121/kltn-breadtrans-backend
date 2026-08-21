import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiGeneratorController } from './ai-generator.controller';
import { AiGeneratorService } from './ai-generator.service';
import { GeminiEvaluatorStrategy } from './strategies/gemini-evaluator.strategy';
import { AI_EVALUATOR_TOKEN } from './strategies/ai-evaluator.interface';
import { UploadModule } from '../upload/upload.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [UploadModule, PrismaModule],
  controllers: [AiController, AiGeneratorController],
  providers: [
    AiService,
    AiGeneratorService,
    {
      provide: AI_EVALUATOR_TOKEN,
      useClass: GeminiEvaluatorStrategy,
    },
  ],
  exports: [AiService, AiGeneratorService],
})
export class AiModule {}
