import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PlanCatalogAdminController } from './plan-catalog-admin.controller';
import { PlanCatalogAdminService } from './plan-catalog-admin.service';
import { PlanPurchaseController } from './plan-purchase.controller';
import { PlanPurchaseAdminController } from './plan-purchase-admin.controller';
import { PlanPurchaseService } from './plan-purchase.service';
import { PlanCatalogPublicController } from './plan-catalog-public.controller';
import { PlanCatalogPublicService } from './plan-catalog-public.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentReconciliationScheduler } from './payment-reconciliation.scheduler';
import { PaymentWebhookController } from './payment-webhook.controller';
import { SepayTransactionProvider } from './sepay-transaction.provider';

@Module({
  imports: [PrismaModule],
  controllers: [
    SubscriptionController,
    PlanCatalogAdminController,
    PlanPurchaseController,
    PlanPurchaseAdminController,
    PlanCatalogPublicController,
    PaymentWebhookController,
  ],
  providers: [
    SubscriptionService,
    PlanCatalogAdminService,
    PlanPurchaseService,
    PlanCatalogPublicService,
    SepayTransactionProvider,
    PaymentReconciliationService,
    PaymentReconciliationScheduler,
  ],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
