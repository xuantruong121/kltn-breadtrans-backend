const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const classes = await prisma.class.findMany({
    select: { id: true, name: true }
  });
  console.log('All Classes:');
  for (const c of classes) {
    if (c.name.includes('?')) {
      console.log(`[CONTAINS ?] ID ${c.id}: ${c.name}`);
    } else {
      console.log(`[OK] ID ${c.id}: ${c.name}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
