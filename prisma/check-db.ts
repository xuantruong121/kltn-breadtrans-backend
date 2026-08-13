import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const topics = await p.practiceTopic.findMany({ select: { id: true, name: true, category: true } });
  console.log('PracticeTopics:', JSON.stringify(topics, null, 2));
  const quizCount = await p.quiz.count({ where: { type: 'LISTENING_PRACTICE' } });
  console.log('Listening Quiz count:', quizCount);
  const vocabTopics = await p.vocabTopic.count();
  console.log('VocabTopic count:', vocabTopics);
  const speakingCount = await p.speakingExercise.count();
  console.log('SpeakingExercise count:', speakingCount);
  await p.$disconnect();
}
main();
