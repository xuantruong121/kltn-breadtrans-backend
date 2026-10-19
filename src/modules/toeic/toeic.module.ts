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
import { GenericExamService } from './generic-exam.service';
import { GenericExamController } from './generic-exam.controller';
import { SkillCmsModule } from '../content/skill-cms.module';
import { AiModule } from '../ai/ai.module';
import { UploadModule } from '../upload/upload.module';
import { ToeicAiExamService } from './toeic-ai-exam.service';
import { PixabayImageSearchProvider } from './pixabay-image-search.provider';
import { OpenverseImageSearchProvider } from './openverse-image-search.provider';
import { ImageSearchProviderChain } from './image-search.provider-chain';
import { WikimediaCommonsImageSearchProvider } from './wikimedia-commons-image-search.provider';

@Module({
  imports: [SpeakingModule, QuizModule, SkillCmsModule, AiModule, UploadModule],
  controllers: [
    ToeicController,
    AdminExamController,
    AdminToeicAssessmentController,
    ToeicAssessmentController,
    GenericExamController,
  ],
  providers: [
    ToeicService,
    AdminExamService,
    ToeicAssessmentService,
    GenericExamService,
    ToeicAiExamService,
    PixabayImageSearchProvider,
    OpenverseImageSearchProvider,
    WikimediaCommonsImageSearchProvider,
    ImageSearchProviderChain,
  ],
  exports: [
    ToeicService,
    AdminExamService,
    ToeicAssessmentService,
    GenericExamService,
    ToeicAiExamService,
  ],
})
export class ToeicModule {}
