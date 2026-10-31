import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { LearnerProgressService } from './learner-progress.service';

/** Prisma only, so the speaking worker process can load it. */
@Module({
  imports: [PrismaModule],
  providers: [LearnerProgressService],
  exports: [LearnerProgressService],
})
export class LearnerProgressModule {}
