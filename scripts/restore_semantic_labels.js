const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const targetIds = [2003, 2007, 2010];
  for (const id of targetIds) {
    const q = await prisma.diagnosticQuestion.findUnique({ where: { id } });
    if (!q) {
      console.log(`Question ${id} not found`);
      continue;
    }
    const currentOptions = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
    const updatedOptions = { ...currentOptions, skill: 'Grammar' };
    await prisma.diagnosticQuestion.update({
      where: { id },
      data: {
        skill: 'Grammar',
        options: updatedOptions,
      },
    });
    console.log(`Updated question ${id} to Grammar`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
