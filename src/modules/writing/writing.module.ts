import { Module } from '@nestjs/common';
import { WritingController } from './writing.controller';
import { WritingService } from './writing.service';
import { AiModule } from '../ai/ai.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { QuizModule } from '../quiz/quiz.module';
import {
  AdminToeicWritingSetController,
  ToeicWritingSetController,
} from './toeic-writing-set.controller';
import { ToeicWritingSetService } from './toeic-writing-set.service';

@Module({
  imports: [AiModule, PrismaModule, QuizModule],
  controllers: [
    WritingController,
    AdminToeicWritingSetController,
    ToeicWritingSetController,
  ],
  providers: [WritingService, ToeicWritingSetService],
})
export class WritingModule {}
