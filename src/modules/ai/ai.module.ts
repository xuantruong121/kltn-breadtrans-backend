import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { GeminiEvaluatorStrategy } from './strategies/gemini-evaluator.strategy';
import { AI_EVALUATOR_TOKEN } from './strategies/ai-evaluator.interface';
// import { OpenAIEvaluatorStrategy } from './strategies/openai-evaluator.strategy';

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    // Đăng ký Strategy mặc định ở đây. 
    // Muốn đổi sang ChatGPT? Chỉ cần đổi useClass thành OpenAIEvaluatorStrategy!
    {
      provide: AI_EVALUATOR_TOKEN,
      useClass: GeminiEvaluatorStrategy,
    },
  ],
  exports: [AiService],
})
export class AiModule {}
