import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QuizModule } from '../quiz/quiz.module';
import { SpeakingModule } from '../speaking/speaking.module';
import { UploadModule } from '../upload/upload.module';
import { SkillCmsController } from './skill-cms.controller';
import { SkillCmsService } from './skill-cms.service';
import { SpeakingCategoryController } from './speaking-category.controller';
import { SpeakingCategoryService } from './speaking-category.service';

@Module({
  imports: [PrismaModule, QuizModule, SpeakingModule, UploadModule],
  controllers: [SpeakingCategoryController, SkillCmsController],
  providers: [SkillCmsService, SpeakingCategoryService],
  exports: [SkillCmsService, SpeakingCategoryService],
})
export class SkillCmsModule {}
