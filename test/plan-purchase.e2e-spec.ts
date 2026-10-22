import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  PlanPaymentStatus,
  PlanPurchaseStatus,
  PlanStatus,
  PlanVersionStatus,
  Role,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { TransformInterceptor } from './../src/common/interceptors/transform.interceptor';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Plan purchase ownership and admin review (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let adminId: number;
  let studentId: number;
  let otherStudentId: number;
  let purchaseId: number;
  let planId: number;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;

  const tokenFor = (id: number, email: string, role: Role) =>
    jwt.sign({
      sub: id,
      email,
      role,
      deviceId: `e2e-plan-${suffix}`,
      type: 'access',
      jti: `${suffix}-${id}`,
    });

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl.includes('kltn_test_db')) {
      throw new Error('E2E plan-purchase suite requires kltn_test_db');
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const admin = await prisma.user.create({
      data: {
        email: `qa-plan-admin-${suffix}@breadtrans.test`,
        role: Role.ADMIN,
      },
    });
    const student = await prisma.user.create({
      data: {
        email: `qa-plan-student-${suffix}@breadtrans.test`,
        role: Role.STUDENT,
      },
    });
    const otherStudent = await prisma.user.create({
      data: {
        email: `qa-plan-other-${suffix}@breadtrans.test`,
        role: Role.STUDENT,
      },
    });
    adminId = admin.id;
    studentId = student.id;
    otherStudentId = otherStudent.id;

    const plan = await prisma.plan.create({
      data: {
        code: `QA_PLUS_${suffix}`,
        displayName: 'BreadTrans Plus QA',
        status: PlanStatus.ACTIVE,
        versions: {
          create: {
            version: 1,
            displayName: 'BreadTrans Plus 30 ngày',
            durationDays: 30,
            priceVnd: 69_000,
            status: PlanVersionStatus.PUBLISHED,
            isCurrent: true,
            publishedAt: new Date(),
          },
        },
      },
      include: { versions: true },
    });
    planId = plan.id;
    const purchase = await prisma.planPurchase.create({
      data: {
        userId: studentId,
        planVersionId: plan.versions[0].id,
        amountVnd: 69_000,
        durationDays: 30,
        idempotencyKey: `qa-plan-purchase-${suffix}`,
        payment: {
          create: {
            amountVnd: 69_000,
            transferCode: `BTPQA${suffix.replace(/\D/g, '').slice(-8)}`,
          },
        },
      },
    });
    purchaseId = purchase.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.subscriptionEvent
        .deleteMany({ where: { subscription: { planPurchaseId: purchaseId } } })
        .catch(() => null);
      await prisma.subscription.deleteMany({
        where: { planPurchaseId: purchaseId },
      });
      await prisma.planPayment.deleteMany({
        where: { planPurchaseId: purchaseId },
      });
      await prisma.planPurchase.deleteMany({ where: { id: purchaseId } });
      await prisma.planVersion.deleteMany({ where: { planId } });
      await prisma.plan.deleteMany({ where: { id: planId } });
      await prisma.user.deleteMany({
        where: { id: { in: [adminId, studentId, otherStudentId] } },
      });
      await prisma.$disconnect();
    }
    await app?.close();
  });

  it('keeps the admin queue protected and lists plan purchases for an admin', async () => {
    await request(app.getHttpServer()).get('/admin/plan-purchases').expect(401);

    await request(app.getHttpServer())
      .get('/admin/plan-purchases')
      .set(
        'Authorization',
        `Bearer ${tokenFor(studentId, `qa-plan-student-${suffix}@breadtrans.test`, Role.STUDENT)}`,
      )
      .expect(403);

    const response = await request(app.getHttpServer())
      .get(`/admin/plan-purchases?search=qa-plan-student-${suffix}`)
      .set(
        'Authorization',
        `Bearer ${tokenFor(adminId, `qa-plan-admin-${suffix}@breadtrans.test`, Role.ADMIN)}`,
      )
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({
      id: purchaseId,
      userId: studentId,
      status: PlanPurchaseStatus.PENDING_PAYMENT,
      payment: { status: PlanPaymentStatus.PENDING, amountVnd: 69_000 },
    });
  });

  it('enforces purchase ownership and ignores client attempts to confirm payment', async () => {
    await request(app.getHttpServer())
      .get(`/plan-purchases/${purchaseId}`)
      .set(
        'Authorization',
        `Bearer ${tokenFor(otherStudentId, `qa-plan-other-${suffix}@breadtrans.test`, Role.STUDENT)}`,
      )
      .expect(404);

    await request(app.getHttpServer())
      .post(`/plan-purchases/${purchaseId}/report-transfer`)
      .set(
        'Authorization',
        `Bearer ${tokenFor(studentId, `qa-plan-student-${suffix}@breadtrans.test`, Role.STUDENT)}`,
      )
      .send({ status: 'CONFIRMED', amountVnd: 0 })
      .expect(200);

    const payment = await prisma.planPayment.findUniqueOrThrow({
      where: { planPurchaseId: purchaseId },
    });
    expect(payment.status).toBe(PlanPaymentStatus.REPORTED);
    expect(payment.amountVnd).toBe(69_000);
  });

  it('allows exactly the admin confirmation path to activate one subscription', async () => {
    const adminToken = tokenFor(
      adminId,
      `qa-plan-admin-${suffix}@breadtrans.test`,
      Role.ADMIN,
    );
    const first = await request(app.getHttpServer())
      .post(`/admin/plan-purchases/${purchaseId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(first.body.data).toMatchObject({
      id: purchaseId,
      status: PlanPurchaseStatus.COMPLETED,
      payment: { status: PlanPaymentStatus.CONFIRMED },
    });

    await request(app.getHttpServer())
      .post(`/admin/plan-purchases/${purchaseId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(
      await prisma.subscription.count({
        where: { planPurchaseId: purchaseId },
      }),
    ).toBe(1);
  });
});
