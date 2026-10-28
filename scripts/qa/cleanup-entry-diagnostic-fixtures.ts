import { PrismaClient } from '@prisma/client';

import { assertIsolatedTargets, readIsolatedTargets } from './qa-target-guard';

// Creates/deletes users: explicit, verified isolated target only (CP60.2);
// never the backend .env (kltn_db).
const selected = readIsolatedTargets();
if (!selected.ok) throw new Error(`QA target refused: ${selected.reason}`);
const prisma = new PrismaClient({
  datasources: { db: { url: selected.targets.databaseUrl } },
});
const prefix = process.argv[2];
if (!prefix)
  throw new Error('Usage: cleanup-entry-diagnostic-fixtures.ts <email-prefix>');

async function main() {
  await assertIsolatedTargets();
  const users = await prisma.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true, email: true },
  });
  for (const user of users) {
    await prisma.subscription.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  console.log(JSON.stringify({ prefix, deleted: users }, null, 2));
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
