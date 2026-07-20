import { PrismaClient, Role, QuizType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({ log: ['info', 'warn', 'error'] });

async function clearDB() {
  console.log('Clearing old data...');
  await prisma.speakingSubmission.deleteMany();
  await prisma.speakingExercise.deleteMany();
  await prisma.userBadge.deleteMany();
  await prisma.pointHistory.deleteMany();
  await prisma.leaderboard.deleteMany();
  await prisma.result.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.question.deleteMany();
  await prisma.quiz.deleteMany();
  await prisma.material.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.course.deleteMany();
  await prisma.badge.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  await clearDB();
  console.log('Seeding fake data (10+ records per table)...');

  const passwordHash = await bcrypt.hash('123456', 10);

  // 1. Fake Users (1 Admin, 3 Teachers, 6 Students = 10 Users)
  const users = [];
  
  // Admin
  users.push(await prisma.user.create({
    data: { email: 'admin@breadtrans.com', password: passwordHash, role: Role.ADMIN, profile: { create: { fullName: 'Admin System' } } }
  }));

  // 3 Teachers
  for (let i = 1; i <= 3; i++) {
    users.push(await prisma.user.create({
      data: { email: `teacher${i}@breadtrans.com`, password: passwordHash, role: Role.TEACHER, profile: { create: { fullName: `Teacher ${i}` } } }
    }));
  }

  // 6 Students
  for (let i = 1; i <= 6; i++) {
    users.push(await prisma.user.create({
      data: { email: `student${i}@breadtrans.com`, password: passwordHash, role: Role.STUDENT, profile: { create: { fullName: `Student ${i}`, targetScore: `IELTS ${6.0 + i * 0.5}` } } }
    }));
  }

  const teachers = users.filter(u => u.role === Role.TEACHER);
  const students = users.filter(u => u.role === Role.STUDENT);

  // 2. Fake Badges (10 Badges)
  const badges = [];
  for (let i = 1; i <= 10; i++) {
    badges.push(await prisma.badge.create({
      data: {
        name: `Huy hiệu Cấp ${i}`,
        description: `Dành cho học viên đạt ${i * 100} điểm`,
        criteria: { type: 'POINTS', threshold: i * 100 },
        iconUrl: `https://example.com/badge${i}.png`
      }
    }));
  }

  // 3. Fake Courses (10 Courses)
  const courses = [];
  for (let i = 1; i <= 10; i++) {
    courses.push(await prisma.course.create({
      data: {
        title: `Khóa học Tiếng Anh Chuyên Sâu ${i}`,
        description: `Mô tả chi tiết cho khóa học ${i}`,
        price: 500000 + i * 50000,
        thumbnail: `https://example.com/course${i}.jpg`
      }
    }));
  }

  // 4. Fake Classes (10 Classes)
  const classes = [];
  for (let i = 0; i < 10; i++) {
    const course = courses[i];
    const teacher = teachers[i % teachers.length];
    classes.push(await prisma.class.create({
      data: {
        courseId: course.id,
        teacherId: teacher.id,
        name: `Lớp ${course.title} - Ca tối`,
        meetingLink: `https://meet.google.com/xyz-123-${i}`
      }
    }));
  }

  // 5. Fake Lessons & Materials (10 Lessons, each with 1 Material)
  for (let i = 0; i < 10; i++) {
    const cls = classes[i];
    const lesson = await prisma.lesson.create({
      data: {
        classId: cls.id,
        title: `Bài giảng ${i + 1}`,
        description: `Nội dung bài giảng ${i + 1}`,
        order: 1,
        videoUrl: `https://youtube.com/watch?v=vid${i}`
      }
    });

    await prisma.material.create({
      data: {
        lessonId: lesson.id,
        title: `Tài liệu PDF cho bài ${i + 1}`,
        fileUrl: `https://example.com/doc${i + 1}.pdf`,
        fileType: 'PDF'
      }
    });
  }

  // 6. Fake Enrollments (10 Enrollments)
  for (let i = 0; i < 10; i++) {
    const student = students[i % students.length];
    const cls = classes[i];
    await prisma.enrollment.create({
      data: {
        userId: student.id,
        classId: cls.id,
        progress: Math.floor(Math.random() * 100),
      }
    });
  }

  // 7. Fake Quizzes & Questions (10 Quizzes, 2 questions each)
  const quizTypes = [QuizType.GENERAL, QuizType.IELTS, QuizType.TOEIC, QuizType.VSTEP];
  for (let i = 0; i < 10; i++) {
    const course = courses[i];
    await prisma.quiz.create({
      data: {
        courseId: course.id,
        title: `Đề thi trắc nghiệm ${i + 1}`,
        description: `Bài kiểm tra đánh giá năng lực ${i + 1}`,
        timeLimit: 45,
        type: quizTypes[i % quizTypes.length],
        questions: {
          create: [
            {
              type: 'MULTIPLE_CHOICE',
              order: 1,
              content: { text: `Câu hỏi trắc nghiệm số 1 của đề ${i+1}?`, options: ['A', 'B', 'C', 'D'], correct: 'A' }
            },
            {
              type: 'WRITING',
              order: 2,
              content: { text: `Viết một đoạn văn ngắn về chủ đề ${i+1}.` }
            }
          ]
        }
      }
    });
  }

  // 8. Speaking Exercises (10 bài tập phát âm các level khác nhau)
  const speakingData = [
    // BEGINNER
    { title: 'Basic Greetings', targetText: 'Hello! My name is Nam. I am a student. Nice to meet you!', difficulty: 'BEGINNER', category: 'GENERAL' },
    { title: 'Numbers and Days', targetText: 'Today is Monday. There are seven days in a week. The first month of the year is January.', difficulty: 'BEGINNER', category: 'GENERAL' },
    { title: 'Daily Routine', targetText: 'I wake up at six o\'clock every morning. Then I brush my teeth, have breakfast, and go to school.', difficulty: 'BEGINNER', category: 'GENERAL' },
    // INTERMEDIATE
    { title: 'TOEIC: Office Communication', targetText: 'The meeting has been rescheduled to Thursday afternoon. Please bring your project reports and performance summaries.', difficulty: 'INTERMEDIATE', category: 'TOEIC' },
    { title: 'TOEIC: Business Travel', targetText: 'I would like to book a single room for three nights, from the fifteenth to the eighteenth of November.', difficulty: 'INTERMEDIATE', category: 'TOEIC' },
    { title: 'Environmental Issues', targetText: 'Climate change is one of the most pressing challenges of our time. We must reduce carbon emissions to protect the planet for future generations.', difficulty: 'INTERMEDIATE', category: 'GENERAL' },
    { title: 'Technology in Education', targetText: 'Digital learning platforms have transformed the way students access information. Online education offers flexibility and a wide range of resources.', difficulty: 'INTERMEDIATE', category: 'GENERAL' },
    // ADVANCED
    { title: 'IELTS: Problem & Solution', targetText: 'Although urbanization brings economic growth, it also leads to overcrowding and environmental degradation. Governments should invest in sustainable infrastructure and promote green spaces within cities.', difficulty: 'ADVANCED', category: 'IELTS' },
    { title: 'IELTS: Technology & Society', targetText: 'The rapid advancement of artificial intelligence raises significant ethical concerns regarding privacy, employment, and decision-making. Society must establish regulatory frameworks to ensure responsible development.', difficulty: 'ADVANCED', category: 'IELTS' },
    { title: 'IELTS: Global Economy', targetText: 'International trade agreements foster economic interdependence, yet they can expose developing nations to exploitation. Policymakers must strike a balance between liberalization and the protection of domestic industries.', difficulty: 'ADVANCED', category: 'IELTS' },
  ];

  for (const ex of speakingData) {
    await prisma.speakingExercise.create({ data: ex });
  }
  console.log(`✓ Seeded ${speakingData.length} Speaking Exercises`);

  console.log('Seeding finished successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
