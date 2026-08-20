import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('\n📊 DATABASE SUMMARY AUDIT:');
  console.log('-------------------------------------------');
  console.log('👥 Users:', await prisma.user.count());
  console.log('🧑‍🏫 Teachers:', await prisma.user.count({ where: { role: 'TEACHER' } }));
  console.log('👨‍🎓 Students:', await prisma.user.count({ where: { role: 'STUDENT' } }));
  console.log('📚 Courses:', await prisma.course.count());
  console.log('🏫 Classes:', await prisma.class.count());
  console.log('📅 Sessions:', await prisma.session.count());
  console.log('📋 Attendances:', await prisma.attendance.count());
  console.log('📁 Materials:', await prisma.material.count());
  console.log('📝 Assignments:', await prisma.assignment.count());
  console.log('✍️ Assignment Submissions:', await prisma.assignmentSubmission.count());
  console.log('🛍️ Market Products:', await prisma.marketProduct.count());
  console.log('📦 Market Orders:', await prisma.marketOrder.count());
  console.log('🗂️ Vocab Topics:', await prisma.vocabTopic.count());
  console.log('🔤 Vocab Words:', await prisma.vocabWord.count());
  console.log('📖 Practice Topics:', await prisma.practiceTopic.count());
  console.log('❓ Quizzes:', await prisma.quiz.count());
  console.log('❓ Questions:', await prisma.question.count());
  console.log('🏆 TOEIC Exam Sets:', await prisma.toeicExamSet.count());
  console.log('🎙️ Speaking Exercises:', await prisma.speakingExercise.count());
  console.log('🎬 Content Topics (Phim/Nhạc):', await prisma.contentTopic.count());
  console.log('-------------------------------------------\n');
  await prisma.$disconnect();
}

main();
