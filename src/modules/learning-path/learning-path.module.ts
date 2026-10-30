import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { LearningPathController } from './learning-path.controller';
import { LearningPathService } from './learning-path.service';

@Module({
  imports: [PrismaModule, SubscriptionModule],
  controllers: [LearningPathController],
  providers: [LearningPathService],
  exports: [LearningPathService],
})
export class LearningPathModule {}
