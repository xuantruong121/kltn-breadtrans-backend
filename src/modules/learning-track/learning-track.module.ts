import { Module } from '@nestjs/common';

import {
  AdminLearningTrackController,
  LearningTrackController,
} from './learning-track.controller';
import { LearningTrackService } from './learning-track.service';

@Module({
  controllers: [LearningTrackController, AdminLearningTrackController],
  providers: [LearningTrackService],
  exports: [LearningTrackService],
})
export class LearningTrackModule {}
