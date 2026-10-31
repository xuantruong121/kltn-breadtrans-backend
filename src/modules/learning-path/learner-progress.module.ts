import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { LearnerProgressService } from './learner-progress.service';
import { LevelAccessService } from './level-access.service';

/** Prisma only, so the speaking worker process can load it. */
@Module({
  imports: [PrismaModule],
  providers: [LearnerProgressService, LevelAccessService],
  exports: [LearnerProgressService, LevelAccessService],
})
export class LearnerProgressModule {}
