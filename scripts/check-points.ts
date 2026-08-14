import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const points = await prisma.pointHistory.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log(points);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
