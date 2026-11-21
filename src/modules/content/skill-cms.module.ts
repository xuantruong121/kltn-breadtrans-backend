import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QuizModule } from '../quiz/quiz.module';
import { SpeakingModule } from '../speaking/speaking.module';
import { UploadModule } from '../upload/upload.module';
import { SkillCmsController } from './skill-cms.controller';
import { SkillCmsService } from './skill-cms.service';
import { SpeakingCategoryService } from './speaking-category.service';

@Module({
  imports: [PrismaModule, QuizModule, SpeakingModule, UploadModule],
  // No SpeakingCategoryController: Phân loại folded into Lĩnh vực
  // (2026-11-21). The service stays for the GENERAL lookup and old labels.
  controllers: [SkillCmsController],
  providers: [SkillCmsService, SpeakingCategoryService],
  exports: [SkillCmsService, SpeakingCategoryService],
})
export class SkillCmsModule {}
