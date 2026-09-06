const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.class.update({
    where: { id: 37 },
    data: { name: 'Lớp Giao Tiếp K05 Semantics Test' },
  });
  console.log('Class 37 name updated successfully:', updated.name);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
