import { Module } from '@nestjs/common';
import { ToeicService } from './toeic.service';
import { ToeicController } from './toeic.controller';
import { AdminExamService } from './admin-exam.service';
import { AdminExamController } from './admin-exam.controller';
import { SpeakingModule } from '../speaking/speaking.module';
import { QuizModule } from '../quiz/quiz.module';
import { ToeicAssessmentService } from './toeic-assessment.service';
import {
  AdminToeicAssessmentController,
  ToeicAssessmentController,
} from './toeic-assessment.controller';

@Module({
  imports: [SpeakingModule, QuizModule],
  controllers: [
    ToeicController,
    AdminExamController,
    AdminToeicAssessmentController,
    ToeicAssessmentController,
  ],
  providers: [ToeicService, AdminExamService, ToeicAssessmentService],
  exports: [ToeicService, AdminExamService, ToeicAssessmentService],
})
export class ToeicModule {}
