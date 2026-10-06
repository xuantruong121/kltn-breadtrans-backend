import { Module } from '@nestjs/common';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { AiModule } from '../ai/ai.module';
import { SpeakingModule } from '../speaking/speaking.module';
import { UploadModule } from '../upload/upload.module';
import { ListeningAudioAuthoringService } from './listening-audio-authoring.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { QuizContentAccessService } from './quiz-content-access.service';

@Module({
  imports: [
    AiModule,
    SpeakingModule,
    UploadModule,
    PrismaModule,
    SubscriptionModule,
  ],
  providers: [
    QuizService,
    ListeningAudioAuthoringService,
    QuizContentAccessService,
  ],
  controllers: [QuizController],
  exports: [QuizContentAccessService],
})
export class QuizModule {}
