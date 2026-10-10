import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const prefix = `entry-v2-qa-${Date.now()}`;
const password = 'EntryDiagnosticQA!2026';

async function main() {
  const plans = await prisma.plan.findMany({
    where: { code: { in: ['PLUS', 'PRO'] } },
    include: {
      versions: { where: { status: 'PUBLISHED', isCurrent: true }, take: 1 },
    },
  });
  const byCode = new Map(plans.map((plan) => [plan.code, plan.versions[0]]));
  const users: Array<{
    email: string;
    password: string;
    tier: string;
    userId: number;
  }> = [];
  for (const tier of ['FREE', 'PLUS', 'PRO']) {
    const user = await prisma.user.create({
      data: {
        email: `${prefix}-${tier.toLowerCase()}@breadtrans.local`,
        password: await bcrypt.hash(password, 12),
        emailVerifiedAt: new Date(),
        profile: { create: { fullName: `Entry Diagnostic QA ${tier}` } },
      },
    });
    const version = tier === 'FREE' ? null : byCode.get(tier);
    if (version)
      await prisma.subscription.create({
        data: {
          userId: user.id,
          planVersionId: version.id,
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 60_000),
          endsAt: new Date(Date.now() + 7 * 86400000),
        },
      });
    users.push({ email: user.email, password, tier, userId: user.id });
  }
  console.log(JSON.stringify({ prefix, users }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
