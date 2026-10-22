import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentService } from './payment.service';
import { PayosProvider } from './payos.provider';
import { PayosPaymentService } from './payos-payment.service';
import { PayosPaymentController } from './payos-payment.controller';

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  // Legacy course-payment controllers are intentionally not registered.
  // This module remains the shared PayOS infrastructure for plan purchases.
  controllers: [PayosPaymentController],
  providers: [
    PaymentService,
    PayosProvider,
    PayosPaymentService,
    { provide: 'PaymentService', useExisting: PaymentService },
  ],
  exports: [PaymentService, PayosPaymentService],
})
export class PaymentModule {}
