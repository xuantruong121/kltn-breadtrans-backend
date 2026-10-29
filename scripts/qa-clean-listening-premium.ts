import './qa/qa-legacy-guard';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const deleted = await prisma.user.deleteMany({
      where: { email: { startsWith: 'qa-listening-premium-25-' } },
    });
    console.log(JSON.stringify({ QA_LISTENING_PREMIUM_CLEANUP_DELETED: deleted.count }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
