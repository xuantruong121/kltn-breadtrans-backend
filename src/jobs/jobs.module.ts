import { Module } from '@nestjs/common';
import { GamificationModule } from '../modules/gamification/gamification.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { UploadModule } from '../modules/upload/upload.module';
import { SystemJobsScheduler } from './system-jobs.scheduler';
import { SystemJobsService } from './system-jobs.service';

@Module({
  imports: [GamificationModule, NotificationsModule, UploadModule],
  providers: [SystemJobsService, SystemJobsScheduler],
})
export class JobsModule {}
