import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { AdminSupportController } from './admin-support.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
