import { Module } from '@nestjs/common';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';
import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { QuizModule } from '../quiz/quiz.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { MistakesModule } from '../mistakes/mistakes.module';
import {
  AdminToeicWritingSetController,
  ToeicWritingSetController,
} from './toeic-writing-set.controller';
import { ToeicWritingSetService } from './toeic-writing-set.service';
import { TranslationReviewController } from './translation-review.controller';
import { TranslationReviewService } from './translation-review.service';

@Module({
  imports: [
    AiModule,
    PrismaModule,
    QuizModule,
    SubscriptionModule,
    MistakesModule,
  ],
  controllers: [
    WritingController,
    AdminToeicWritingSetController,
    ToeicWritingSetController,
    TranslationReviewController,
  ],
  providers: [WritingService, ToeicWritingSetService, TranslationReviewService],
  exports: [WritingService],
})
export class WritingModule {}
