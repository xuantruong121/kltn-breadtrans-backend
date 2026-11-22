import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QuizModule } from '../quiz/quiz.module';
import { SpeakingModule } from '../speaking/speaking.module';
import { UploadModule } from '../upload/upload.module';
import { SkillCmsController } from './skill-cms.controller';
import { SkillCmsService } from './skill-cms.service';

@Module({
  imports: [PrismaModule, QuizModule, SpeakingModule, UploadModule],
  // No speaking category controller or service: Phân loại folded into Lĩnh
  // vực (2026-11-21), and its table was dropped (2026-11-22).
  controllers: [SkillCmsController],
  providers: [SkillCmsService],
  exports: [SkillCmsService],
})
export class SkillCmsModule {}
