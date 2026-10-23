import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ensureCanonicalPlanCatalog } from '../src/modules/subscription/canonical-plan-catalog';

const prisma = new PrismaClient();

async function main() {
  console.log(JSON.stringify({ plans: await ensureCanonicalPlanCatalog(prisma) }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
