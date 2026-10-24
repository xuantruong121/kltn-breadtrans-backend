import { Module } from '@nestjs/common';
import { GamificationModule } from '../modules/gamification/gamification.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { UploadModule } from '../modules/upload/upload.module';
import { SystemJobsScheduler } from './system-jobs.scheduler';
import { SystemJobsService } from './system-jobs.service';
import { DatabaseBackupR2SyncService } from './database-backup-r2-sync.service';

@Module({
  imports: [GamificationModule, NotificationsModule, UploadModule],
  providers: [
    SystemJobsService,
    SystemJobsScheduler,
    DatabaseBackupR2SyncService,
  ],
  exports: [SystemJobsService, DatabaseBackupR2SyncService],
})
export class JobsModule {}
