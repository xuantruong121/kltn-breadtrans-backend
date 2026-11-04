import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsCronService } from './notifications.cron';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailService } from '../../common/email/email.service';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsCronService, EmailService],
  exports: [NotificationsService, NotificationsCronService],
})
export class NotificationsModule {}
