import {
  PrismaClient,
  Role,
  CourseStatus,
  ClassStatus,
  EnrollmentStatus,
  PaymentStatus,
} from '@prisma/client';

const FIXTURE_TAG = 'bf_fixture_test_';

export async function assertTestDatabaseSafety(prisma: PrismaClient) {
  const configuredUrl = process.env.DATABASE_URL || '';
  const urlMatches =
    (configuredUrl.includes('localhost') ||
      configuredUrl.includes('127.0.0.1')) &&
    configuredUrl.includes('5432') &&
    (configuredUrl.includes('kltn_test_db') ||
      configuredUrl.includes('kltn_test'));

  if (!urlMatches) {
    throw new Error(
      `SAFETY FUSE ABORT: Configured DATABASE_URL must point to kltn_test_db or kltn_test on localhost:5432. Found: ${configuredUrl.replace(/:[^:@]+@/, ':***@')}`,
    );
  }

  const [dbInfo] = await prisma.$queryRaw<
    Array<{ db: string; schema: string }>
  >`SELECT current_database() AS db, current_schema() AS schema;`;

  if (
    (dbInfo?.db !== 'kltn_test_db' && dbInfo?.db !== 'kltn_test') ||
    dbInfo?.schema !== 'public'
  ) {
    throw new Error(
      `SAFETY FUSE ABORT: Connected PostgreSQL database is '${dbInfo?.db}' (schema: '${dbInfo?.schema}'). Refusing to proceed on non-test public schema!`,
    );
  }

  console.log(
    `[SAFETY FUSE PASSED] Verified exact target: ${dbInfo.db}.${dbInfo.schema}`,
  );
}

export async function setupFixtures(prisma: PrismaClient) {
  await assertTestDatabaseSafety(prisma);
  console.log('Setting up dedicated backfill fixtures in kltn_test_db...');

  // 1. Users
  const teacher = await prisma.user.upsert({
    where: { email: `${FIXTURE_TAG}teacher@breadtrans.com` },
    update: {},
    create: {
      email: `${FIXTURE_TAG}teacher@breadtrans.com`,
      password: 'fixture_password_123',
      role: Role.TEACHER,
    },
  });

  const student1 = await prisma.user.upsert({
    where: { email: `${FIXTURE_TAG}student1@breadtrans.com` },
    update: {},
    create: {
      email: `${FIXTURE_TAG}student1@breadtrans.com`,
      password: 'fixture_password_123',
      role: Role.STUDENT,
    },
  });

  const student2 = await prisma.user.upsert({
    where: { email: `${FIXTURE_TAG}student2@breadtrans.com` },
    update: {},
    create: {
      email: `${FIXTURE_TAG}student2@breadtrans.com`,
      password: 'fixture_password_123',
      role: Role.STUDENT,
    },
  });

  const student3 = await prisma.user.upsert({
    where: { email: `${FIXTURE_TAG}student3@breadtrans.com` },
    update: {},
    create: {
      email: `${FIXTURE_TAG}student3@breadtrans.com`,
      password: 'fixture_password_123',
      role: Role.STUDENT,
    },
  });

  // 2. Course
  let course = await prisma.course.findFirst({
    where: { title: `${FIXTURE_TAG}Course` },
  });
  if (!course) {
    course = await prisma.course.create({
      data: {
        title: `${FIXTURE_TAG}Course`,
        description: 'Course for backfill testing',
        status: CourseStatus.PUBLISHED,
        teacherId: teacher.id,
      },
    });
  }

  // 3. Classes: Class 1 (Paid: 500k), Class 2 (Free: 0)
  let paidClass = await prisma.class.findFirst({
    where: { name: `${FIXTURE_TAG}PaidClass`, courseId: course.id },
  });
  if (!paidClass) {
    paidClass = await prisma.class.create({
      data: {
        name: `${FIXTURE_TAG}PaidClass`,
        courseId: course.id,
        teacherId: teacher.id,
        tuitionFeeVnd: 500000,
        status: ClassStatus.UPCOMING,
        capacity: 20,
      },
    });
  }

  let freeClass = await prisma.class.findFirst({
    where: { name: `${FIXTURE_TAG}FreeClass`, courseId: course.id },
  });
  if (!freeClass) {
    freeClass = await prisma.class.create({
      data: {
        name: `${FIXTURE_TAG}FreeClass`,
        courseId: course.id,
        teacherId: teacher.id,
        tuitionFeeVnd: 0,
        status: ClassStatus.UPCOMING,
        capacity: 20,
      },
    });
  }

  // 4. Enrollments (NO Payments)
  // Fixture 1: PENDING_PAYMENT, fee 500k, no Payment
  const f1 = await prisma.enrollment.upsert({
    where: { userId_classId: { userId: student1.id, classId: paidClass.id } },
    update: { status: EnrollmentStatus.PENDING_PAYMENT },
    create: {
      userId: student1.id,
      classId: paidClass.id,
      status: EnrollmentStatus.PENDING_PAYMENT,
    },
  });

  // Fixture 2: PENDING_PAYMENT, fee 0, no Payment (Inconsistent)
  const f2 = await prisma.enrollment.upsert({
    where: { userId_classId: { userId: student2.id, classId: freeClass.id } },
    update: { status: EnrollmentStatus.PENDING_PAYMENT },
    create: {
      userId: student2.id,
      classId: freeClass.id,
      status: EnrollmentStatus.PENDING_PAYMENT,
    },
  });

  // Fixture 3: ACTIVE, fee 500k, no Payment
  const f3 = await prisma.enrollment.upsert({
    where: { userId_classId: { userId: student3.id, classId: paidClass.id } },
    update: { status: EnrollmentStatus.ACTIVE },
    create: {
      userId: student3.id,
      classId: paidClass.id,
      status: EnrollmentStatus.ACTIVE,
    },
  });

  console.log(`Fixtures initialized:`);
  console.log(
    `- Fixture 1 (Valid candidate)        : Enrollment #${f1.id} (Paid class, 500,000 VND)`,
  );
  console.log(
    `- Fixture 2 (Inconsistent candidate) : Enrollment #${f2.id} (Free class, 0 VND)`,
  );
  console.log(
    `- Fixture 3 (Non-candidate)          : Enrollment #${f3.id} (ACTIVE, 500,000 VND)`,
  );
}

export async function verifyDryRun(prisma: PrismaClient) {
  await assertTestDatabaseSafety(prisma);
  console.log('Verifying dry-run produced 0 writes in kltn_test_db...');

  const studentEmails = [
    `${FIXTURE_TAG}student1@breadtrans.com`,
    `${FIXTURE_TAG}student2@breadtrans.com`,
    `${FIXTURE_TAG}student3@breadtrans.com`,
  ];

  const fixtureEnrollments = await prisma.enrollment.findMany({
    where: { user: { email: { in: studentEmails } } },
    select: { id: true },
  });

  const enrollmentIds = fixtureEnrollments.map((e) => e.id);
  const paymentCount = await prisma.payment.count({
    where: { enrollmentId: { in: enrollmentIds } },
  });

  if (paymentCount !== 0) {
    throw new Error(
      `DRY-RUN VERIFICATION FAILED: Expected 0 Payment rows, found ${paymentCount}!`,
    );
  }

  console.log('[PASSED] Dry-run produced strictly 0 database writes.');
}

export async function verifyLive(prisma: PrismaClient) {
  await assertTestDatabaseSafety(prisma);
  console.log('Verifying live backfill execution results...');

  const student1 = await prisma.user.findUnique({
    where: { email: `${FIXTURE_TAG}student1@breadtrans.com` },
  });
  const student2 = await prisma.user.findUnique({
    where: { email: `${FIXTURE_TAG}student2@breadtrans.com` },
  });
  const student3 = await prisma.user.findUnique({
    where: { email: `${FIXTURE_TAG}student3@breadtrans.com` },
  });

  if (!student1 || !student2 || !student3) {
    throw new Error('Test fixtures missing in kltn_test_db!');
  }

  const f1 = await prisma.enrollment.findFirst({
    where: { userId: student1.id },
    include: { payment: true },
  });
  const f2 = await prisma.enrollment.findFirst({
    where: { userId: student2.id },
    include: { payment: true },
  });
  const f3 = await prisma.enrollment.findFirst({
    where: { userId: student3.id },
    include: { payment: true },
  });

  // Verify Fixture 1: exactly one Payment with tuition snapshot and BT-{id} transferCode
  if (!f1?.payment) {
    throw new Error('Fixture 1 failed: Expected Payment record, none found!');
  }
  if (f1.payment.amountVnd !== 500000) {
    throw new Error(
      `Fixture 1 failed: Expected amountVnd 500000, got ${f1.payment.amountVnd}!`,
    );
  }
  if (f1.payment.transferCode !== `BT-${f1.id}`) {
    throw new Error(
      `Fixture 1 failed: Expected transferCode 'BT-${f1.id}', got '${f1.payment.transferCode}'!`,
    );
  }
  if (f1.payment.status !== PaymentStatus.PENDING) {
    throw new Error(
      `Fixture 1 failed: Expected status PENDING, got '${f1.payment.status}'!`,
    );
  }

  // Verify Fixture 2 (Inconsistent): zero Payments
  if (f2?.payment) {
    throw new Error(
      'Fixture 2 failed: Inconsistent row received unexpected Payment!',
    );
  }

  // Verify Fixture 3 (ACTIVE): zero Payments
  if (f3?.payment) {
    throw new Error(
      'Fixture 3 failed: ACTIVE row received unexpected Payment!',
    );
  }

  console.log(
    '[PASSED] Live backfill verified: Fixture 1 has valid Payment, Fixtures 2 and 3 have zero Payments.',
  );
}

export async function cleanupFixtures(prisma: PrismaClient) {
  await assertTestDatabaseSafety(prisma);
  console.log(
    'Cleaning up backfill fixtures from kltn_test_db in FK-safe order...',
  );

  const userEmails = [
    `${FIXTURE_TAG}teacher@breadtrans.com`,
    `${FIXTURE_TAG}student1@breadtrans.com`,
    `${FIXTURE_TAG}student2@breadtrans.com`,
    `${FIXTURE_TAG}student3@breadtrans.com`,
  ];

  const users = await prisma.user.findMany({
    where: { email: { in: userEmails } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  if (userIds.length > 0) {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    const enrollmentIds = enrollments.map((e) => e.id);

    // 1. Delete Payments
    if (enrollmentIds.length > 0) {
      await prisma.payment.deleteMany({
        where: { enrollmentId: { in: enrollmentIds } },
      });
    }

    // 2. Delete Enrollments
    await prisma.enrollment.deleteMany({
      where: { userId: { in: userIds } },
    });

    // 3. Delete Classes
    await prisma.class.deleteMany({
      where: { name: { startsWith: FIXTURE_TAG } },
    });

    // 4. Delete Courses
    await prisma.course.deleteMany({
      where: { title: { startsWith: FIXTURE_TAG } },
    });

    // 5. Delete Users
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
  }

  console.log(
    '[PASSED] Backfill test fixtures cleanly removed from kltn_test_db.',
  );
}

// CLI handler
async function main() {
  const action = process.argv[2];
  const prisma = new PrismaClient();

  try {
    switch (action) {
      case 'setup':
        await setupFixtures(prisma);
        break;
      case 'verify-dry-run':
        await verifyDryRun(prisma);
        break;
      case 'verify-live':
        await verifyLive(prisma);
        break;
      case 'cleanup':
        await cleanupFixtures(prisma);
        break;
      default:
        console.log(
          'Usage: ts-node test/fixtures/manage-backfill-fixtures.ts [setup | verify-dry-run | verify-live | cleanup]',
        );
        process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fixture management error:', err);
    process.exit(1);
  });
}
