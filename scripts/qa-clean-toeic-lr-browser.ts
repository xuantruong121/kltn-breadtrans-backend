import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'qa-toeic-lr-' } },
    select: { id: true },
  });
  for (const user of users) await prisma.user.delete({ where: { id: user.id } });
  const remaining = await prisma.user.count({ where: { email: { startsWith: 'qa-toeic-lr-' } } });
  console.log(JSON.stringify({ removed: users.length, remaining }));
  if (remaining) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
