import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentController } from './payment.controller';
import { PaymentAdminController } from './payment-admin.controller';
import { PaymentService } from './payment.service';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentAdminController, PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
