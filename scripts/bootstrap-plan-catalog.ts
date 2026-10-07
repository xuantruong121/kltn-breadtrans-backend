import { PlanStatus, PlanVersionStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function ensurePlan(
  code: string,
  displayName: string,
  description: string,
) {
  return prisma.plan.upsert({
    where: { code },
    create: { code, displayName, description, status: PlanStatus.ACTIVE },
    update: {},
  });
}

async function ensureFreeCurrentVersion(planId: number) {
  const current = await prisma.planVersion.findMany({
    where: {
      planId,
      isCurrent: true,
      status: PlanVersionStatus.PUBLISHED,
    },
  });

  if (current.length > 1) {
    throw new Error('FREE catalog has multiple current published versions');
  }

  if (current.length === 1) {
    return { created: false, version: current[0].version };
  }

  const versions = await prisma.planVersion.findMany({
    where: { planId },
    select: { version: true },
    orderBy: { version: 'desc' },
    take: 1,
  });
  const version = (versions[0]?.version ?? 0) + 1;
  const now = new Date();

  await prisma.planVersion.create({
    data: {
      planId,
      version,
      displayName: 'Miễn phí',
      description: 'Nền tảng miễn phí cơ bản',
      currency: 'VND',
      status: PlanVersionStatus.PUBLISHED,
      isCurrent: true,
      effectiveFrom: now,
      publishedAt: now,
    },
  });

  return { created: true, version };
}

async function main() {
  const free = await ensurePlan(
    'FREE',
    'Miễn phí',
    'Gói nền tảng miễn phí của BreadTrans',
  );
  const plus = await ensurePlan(
    'PLUS',
    'Plus',
    'Định danh catalog; điều khoản thương mại chưa được công bố',
  );
  const pro = await ensurePlan(
    'PRO',
    'Pro',
    'Định danh catalog; điều khoản thương mại chưa được công bố',
  );
  const freeVersion = await ensureFreeCurrentVersion(free.id);

  console.log(
    JSON.stringify({
      plans: { free: free.id, plus: plus.id, pro: pro.id },
      freeVersion,
      note: 'PLUS and PRO intentionally have no published commercial versions',
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
