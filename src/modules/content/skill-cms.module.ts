import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SkillCmsController } from './skill-cms.controller';
import { SkillCmsService } from './skill-cms.service';

@Module({
  imports: [PrismaModule],
  controllers: [SkillCmsController],
  providers: [SkillCmsService],
  exports: [SkillCmsService],
})
export class SkillCmsModule {}
