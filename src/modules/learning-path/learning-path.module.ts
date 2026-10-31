import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { GateService } from './gate.service';
import { StarterRoadmapService } from './starter-roadmap.service';
import { LearnerProgressModule } from './learner-progress.module';
import { LearningPathController } from './learning-path.controller';
import { LearningPathService } from './learning-path.service';

@Module({
  imports: [PrismaModule, SubscriptionModule, LearnerProgressModule],
  controllers: [LearningPathController],
  providers: [LearningPathService, GateService, StarterRoadmapService],
  exports: [LearningPathService],
})
export class LearningPathModule {}
