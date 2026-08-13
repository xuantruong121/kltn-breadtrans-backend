import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const words = await p.vocabWord.findMany({ take: 5, select: { word: true, ipaUs: true, audioUs: true } });
  console.log('Words:', JSON.stringify(words, null, 2));
  await p.$disconnect();
}
main();
