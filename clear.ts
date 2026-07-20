import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.practiceTopic.deleteMany({});
  console.log('Deleted all topics');
}

main().catch(console.error).finally(() => prisma.$disconnect());
