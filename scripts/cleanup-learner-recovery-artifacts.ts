/** Removes only an identified strict-runtime smoke-test account. */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const artifacts = await prisma.user.findMany({
    where: { email: { startsWith: 'strict-smoke-' }, role: 'STUDENT' },
    select: { id: true, email: true }, orderBy: { id: 'asc' },
  });
  if (apply && artifacts.length) {
    await prisma.$transaction(async (tx) => {
      await tx.user.deleteMany({ where: { id: { in: artifacts.map((user) => user.id) } } });
    });
  }
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'CHECK', artifacts, remaining: await prisma.user.count() }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
