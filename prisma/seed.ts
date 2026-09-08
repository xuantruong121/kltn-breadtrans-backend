import { PrismaClient, Role, CourseStatus, ClassStatus, AssignmentType, QuizType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('Password123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@breadtrans.com' },
    update: { role: Role.ADMIN, password },
    create: {
      email: 'admin@breadtrans.com',
      password,
      role: Role.ADMIN,
      emailVerifiedAt: new Date(),
      profile: { create: { fullName: 'BreadTrans Admin' } },
    },
  });
  const students = await Promise.all(
    ['student1@breadtrans.com', 'student2@breadtrans.com'].map((email, index) =>
      prisma.user.upsert({
        where: { email },
        update: { role: Role.STUDENT, password },
        create: {
          email,
          password,
          role: Role.STUDENT,
          emailVerifiedAt: new Date(),
          profile: { create: { fullName: `Học viên ${index + 1}` } },
        },
      }),
    ),
  );

  const course = await prisma.course.upsert({
    where: { id: 1 },
    update: { status: CourseStatus.PUBLISHED, title: 'TOEIC Self-Paced Foundation' },
    create: {
      title: 'TOEIC Self-Paced Foundation',
      description: 'Lộ trình TOEIC tự học có quiz và luyện kỹ năng.',
      level: 'BEGINNER',
      status: CourseStatus.PUBLISHED,
    },
  });
  const secondCourse = await prisma.course.upsert({
    where: { id: 2 },
    update: { status: CourseStatus.DRAFT },
    create: {
      title: 'English Grammar Self-Paced',
      description: 'Khóa ngữ pháp tự học.',
      level: 'INTERMEDIATE',
      status: CourseStatus.DRAFT,
    },
  });

  const offering = await prisma.class.upsert({
    where: { courseId_name: { courseId: course.id, name: 'TOEIC Foundation - Open Access' } },
    update: { status: ClassStatus.UPCOMING, tuitionFeeVnd: 0 },
    create: {
      courseId: course.id,
      name: 'TOEIC Foundation - Open Access',
      status: ClassStatus.UPCOMING,
      capacity: 100,
      tuitionFeeVnd: 0,
    },
  });
  await prisma.class.upsert({
    where: { courseId_name: { courseId: secondCourse.id, name: 'Grammar - Draft Offering' } },
    update: { status: ClassStatus.UPCOMING },
    create: {
      courseId: secondCourse.id,
      name: 'Grammar - Draft Offering',
      status: ClassStatus.UPCOMING,
      capacity: 100,
      tuitionFeeVnd: 0,
    },
  });

  const lesson = await prisma.lesson.upsert({
    where: { id: 1 },
    update: { courseId: course.id, title: 'Getting Started' },
    create: {
      courseId: course.id,
      title: 'Getting Started',
      description: 'Bài học mở đầu.',
      order: 1,
      videoUrl: 'https://example.com/toeic-start.mp4',
    },
  });
  await prisma.material.upsert({
    where: { id: 1 },
    update: { lessonId: lesson.id, title: 'Starter notes' },
    create: {
      lessonId: lesson.id,
      title: 'Starter notes',
      fileUrl: 'https://example.com/starter-notes.pdf',
      fileType: 'PDF',
    },
  });

  const assignment = await prisma.assignment.upsert({
    where: { id: 1 },
    update: { classId: offering.id, title: 'Starter Quiz' },
    create: {
      classId: offering.id,
      title: 'Starter Quiz',
      description: 'Bài kiểm tra tự chấm.',
      type: AssignmentType.QUIZ,
      quizData: [{ question: 'Choose A', options: ['A', 'B'], correctOptionIndex: 0 }],
    },
  });

  const quiz = await prisma.quiz.upsert({
    where: { id: 1 },
    update: { courseId: course.id, title: 'TOEIC Mini Test' },
    create: {
      courseId: course.id,
      title: 'TOEIC Mini Test',
      description: 'Bài luyện TOEIC mẫu.',
      type: QuizType.TOEIC,
    },
  });
  await prisma.question.upsert({
    where: { id: 1 },
    update: { quizId: quiz.id, content: { text: 'Choose the correct answer' } },
    create: {
      quizId: quiz.id,
      type: 'MULTIPLE_CHOICE',
      content: { text: 'Choose the correct answer', options: ['A', 'B'] },
      order: 1,
    },
  });

  for (const student of students) {
    await prisma.enrollment.upsert({
      where: { userId_classId: { userId: student.id, classId: offering.id } },
      update: { status: 'ACTIVE' },
      create: { userId: student.id, classId: offering.id, status: 'ACTIVE', progress: 0 },
    });
  }

  console.log(`Seeded Admin ${admin.email}, ${students.length} students, course/offering/lesson/quiz/assignment data.`);
  void assignment;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

