import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PayosProvider } from './payos.provider';
import { PayosPaymentService } from './payos-payment.service';
import { PayosPaymentController } from './payos-payment.controller';

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  // Classroom tuition payments are retired (CP60.1). This module is the
  // PayOS infrastructure for plan purchases only.
  controllers: [PayosPaymentController],
  providers: [PayosProvider, PayosPaymentService],
  exports: [PayosPaymentService],
})
export class PaymentModule {}
