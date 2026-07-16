import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  providers: [QuizService],
  controllers: [QuizController],
})
export class QuizModule {}
