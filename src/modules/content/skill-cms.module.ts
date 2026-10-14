import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QuizModule } from '../quiz/quiz.module';
import { SkillCmsController } from './skill-cms.controller';
import { SkillCmsService } from './skill-cms.service';

@Module({
  imports: [PrismaModule, QuizModule],
  controllers: [SkillCmsController],
  providers: [SkillCmsService],
  exports: [SkillCmsService],
})
export class SkillCmsModule {}
