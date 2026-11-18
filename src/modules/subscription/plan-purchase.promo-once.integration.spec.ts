import { BadRequestException } from '@nestjs/common';
import { PlanStatus, PlanVersionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { describeWithIsolatedDatabase } from '../../../test/safety/isolated';
import { PlanPurchaseService } from './plan-purchase.service';
import { SubscriptionService } from './subscription.service';

/**
 * A "once per learner" code on two open purchases of different plans (audit
 * R7, 2026-11-18). Only confirmed redemptions were counted, so a learner who
 * opened Plus with the code, closed the dialog and opened Pro with it had two
 * discounted QRs and could pay both.
 */
describeWithIsolatedDatabase(
  'PlanPurchaseService once-per-learner code',
  () => {
    let prisma: PrismaService;
    let service: PlanPurchaseService;
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const planIds: number[] = [];
    const versionIds: number[] = [];
    let userId: number;
    let promoId: number;
    const code = `ONCE${Math.floor(Math.random() * 1e8)}`;
    const originalBankEnv = {
      bin: process.env.PAYMENT_BANK_BIN,
      name: process.env.PAYMENT_BANK_NAME,
      number: process.env.PAYMENT_BANK_ACCOUNT_NUMBER,
      accountName: process.env.PAYMENT_BANK_ACCOUNT_NAME,
    };

    const newVersion = async (label: string) => {
      const plan = await prisma.plan.create({
        data: {
          code: `TEST_${label}_${suffix}`,
          displayName: `Promo once ${label}`,
          status: PlanStatus.ACTIVE,
        },
      });
      planIds.push(plan.id);
      const version = await prisma.planVersion.create({
        data: {
          planId: plan.id,
          version: 1,
          displayName: `Promo once ${label}`,
          durationDays: 30,
          priceVnd: 100000,
          currency: 'VND',
          status: PlanVersionStatus.PUBLISHED,
          isCurrent: true,
          effectiveFrom: new Date(),
          publishedAt: new Date(),
        },
      });
      versionIds.push(version.id);
      return version.id;
    };

    beforeAll(async () => {
      process.env.PAYMENT_BANK_BIN = '970415';
      process.env.PAYMENT_BANK_NAME = 'Integration Test Bank';
      process.env.PAYMENT_BANK_ACCOUNT_NUMBER = '123456789';
      process.env.PAYMENT_BANK_ACCOUNT_NAME = 'BREADTRANS TEST';
      prisma = new PrismaService();
      await prisma.$connect();
      service = new PlanPurchaseService(
        prisma,
        new SubscriptionService(prisma),
      );
      userId = (
        await prisma.user.create({
          data: { email: `promo_once_${suffix}@breadtrans.local` },
        })
      ).id;
      promoId = (
        await prisma.promoCode.create({
          data: { code, percentOff: 20, planCodes: [], perUserOnce: true },
        })
      ).id;
    });

    afterAll(async () => {
      await prisma.planPayment.deleteMany({
        where: { planPurchase: { userId } },
      });
      await prisma.planPurchase.deleteMany({ where: { userId } });
      await prisma.promoCode.delete({ where: { id: promoId } });
      await prisma.planVersion.deleteMany({
        where: { id: { in: versionIds } },
      });
      await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
      await prisma.user.delete({ where: { id: userId } });
      await prisma.$disconnect();
      for (const [key, value] of [
        ['PAYMENT_BANK_BIN', originalBankEnv.bin],
        ['PAYMENT_BANK_NAME', originalBankEnv.name],
        ['PAYMENT_BANK_ACCOUNT_NUMBER', originalBankEnv.number],
        ['PAYMENT_BANK_ACCOUNT_NAME', originalBankEnv.accountName],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('a second plan with the same code is refused while the first purchase holds it', async () => {
      const plus = await newVersion('PLUS');
      const pro = await newVersion('PRO');

      const first = await service.createPurchase(
        userId,
        plus,
        `once-a-${suffix}`,
        code,
      );
      expect(first.discountVnd).toBeGreaterThan(0);

      await expect(
        service.createPurchase(userId, pro, `once-b-${suffix}`, code),
      ).rejects.toBeInstanceOf(BadRequestException);

      // The same plan again with the code still works: the open purchase it
      // replaces does not count against itself.
      const again = await service.createPurchase(
        userId,
        plus,
        `once-c-${suffix}`,
        code,
      );
      expect(again.discountVnd).toBeGreaterThan(0);
    });
  },
);
