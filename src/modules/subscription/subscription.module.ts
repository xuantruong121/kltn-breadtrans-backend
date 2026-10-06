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

@Module({
  imports: [PrismaModule],
  controllers: [
    SubscriptionController,
    PlanCatalogAdminController,
    PlanPurchaseController,
    PlanPurchaseAdminController,
    PlanCatalogPublicController,
  ],
  providers: [
    SubscriptionService,
    PlanCatalogAdminService,
    PlanPurchaseService,
    PlanCatalogPublicService,
  ],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
