import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { AiModule } from '../ai/ai.module';
import { SpeakingModule } from '../speaking/speaking.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [AiModule, SpeakingModule, UploadModule],
  providers: [QuizService],
  controllers: [QuizController],
})
export class QuizModule {}
