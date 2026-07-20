import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { GeminiEvaluatorStrategy } from './strategies/gemini-evaluator.strategy';
import { AI_EVALUATOR_TOKEN } from './strategies/ai-evaluator.interface';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [UploadModule],
  controllers: [AiController],
  providers: [
    AiService,
    {
      provide: AI_EVALUATOR_TOKEN,
      useClass: GeminiEvaluatorStrategy,
    },
  ],
  exports: [AiService],
})
export class AiModule {}
