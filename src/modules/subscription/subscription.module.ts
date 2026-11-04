import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionAdminController } from './subscription-admin.controller';
import { SubscriptionAdminService } from './subscription-admin.service';
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
import { PaymentModule } from '../payment/payment.module';
import { PayosWebhookController } from './payos-webhook.controller';

import { PromoCodeAdminController } from './promo-code-admin.controller';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { TrialService } from './trial.service';
import { PromoCodeAdminService } from './promo-code-admin.service';

@Module({
  imports: [PrismaModule, PaymentModule, NotificationsModule],
  controllers: [
    SubscriptionController,
    SubscriptionAdminController,
    PlanCatalogAdminController,
    PlanPurchaseController,
    PlanPurchaseAdminController,
    PlanCatalogPublicController,
    PaymentWebhookController,
    PayosWebhookController,
    PromoCodeAdminController,
    ReferralController,
  ],
  providers: [
    SubscriptionService,
    SubscriptionAdminService,
    PlanCatalogAdminService,
    PlanPurchaseService,
    PlanCatalogPublicService,
    PromoCodeAdminService,
    ReferralService,
    TrialService,
    SepayTransactionProvider,
    PaymentReconciliationService,
    PaymentReconciliationScheduler,
    { provide: 'PlanPurchaseService', useExisting: PlanPurchaseService },
  ],
  exports: [SubscriptionService, SubscriptionAdminService, TrialService],
})
export class SubscriptionModule {}
