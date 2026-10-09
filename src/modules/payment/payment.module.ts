import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentController } from './payment.controller';
import { PaymentAdminController } from './payment-admin.controller';
import { PaymentService } from './payment.service';
import { PayosProvider } from './payos.provider';
import { PayosPaymentService } from './payos-payment.service';
import { PayosPaymentController } from './payos-payment.controller';

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  controllers: [
    PaymentAdminController,
    PaymentController,
    PayosPaymentController,
  ],
  providers: [
    PaymentService,
    PayosProvider,
    PayosPaymentService,
    { provide: 'PaymentService', useExisting: PaymentService },
  ],
  exports: [PaymentService, PayosPaymentService],
})
export class PaymentModule {}
