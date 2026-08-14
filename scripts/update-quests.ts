import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.dailyQuest.updateMany({
    where: {
      type: 'COMPLETE_QUIZ'
    },
    data: {
      title: 'Hoàn thành 1 bài Luyện Nghe'
    }
  });
  console.log(`Updated ${result.count} quests.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
