import { PrismaClient, Role, QuizType, TopicCategory, CourseStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({ log: ['info', 'warn', 'error'] });

async function clearDB() {
  console.log('Clearing old data...');
  // Delete all data in reverse dependency order
  const tables = [
    'ToeicSpeakingWritingSubmission', 'ToeicAttemptAnswer', 'ToeicAttempt', 'ToeicQuestion', 'ToeicQuestionGroup', 'ToeicExamSet',
    'UserVocabWordProgress', 'VocabWord', 'VocabTopic',
    'AiUsage', 'WatchTracking', 'GameBattle', 'GamePlay', 'GameSettings',
    'MarketOrder', 'MarketProduct',
    'CurrencyRequest', 'CurrencyTransaction',
    'SpeakingEvalRetry', 'SpeakingSubmission', 'SpeakingExercise',
    'UserBookProgress', 'Leaderboard', 'UserBadge', 'Badge', 'PointHistory',
    'Attendance', 'Session', 'AssignmentSubmission', 'Assignment', 'Announcement',
    'Result', 'Submission', 'Question', 'Quiz', 'PracticeTopic',
    'Material', 'Lesson', 'Enrollment', 'Class', 'Course',
    'UserBilling', 'UserStats', 'Profile', 'User'
  ];

  for (const table of tables) {
    try {
      // @ts-ignore
      if (prisma[table.charAt(0).toLowerCase() + table.slice(1)]) {
        // @ts-ignore
        await prisma[table.charAt(0).toLowerCase() + table.slice(1)].deleteMany();
      }
    } catch (e) {
      console.warn(`Could not clear table ${table}`, e.message);
    }
  }
}

async function main() {
  await clearDB();
  console.log('Seeding comprehensive fake data...');

  const passwordHash = await bcrypt.hash('123456', 10);

  // 1. Fake Users
  const users = [];
  
  // Admin
  users.push(await prisma.user.create({
    data: { 
      email: 'admin@breadtrans.com', password: passwordHash, role: Role.ADMIN, 
      profile: { create: { fullName: 'Admin System' } },
      stats: { create: { totalBanhRan: 1000000, countHeart: 999 } },
      billing: { create: { bankName: 'MBBank', bankAccountNumber: '123456789' } }
    }
  }));

  // 3 Teachers
  for (let i = 1; i <= 3; i++) {
    users.push(await prisma.user.create({
      data: { 
        email: `teacher${i}@breadtrans.com`, password: passwordHash, role: Role.TEACHER, 
        profile: { create: { fullName: `Teacher ${i}` } },
        stats: { create: { totalBanhRan: 5000 } },
        billing: { create: { bankName: 'Vietcombank', bankAccountNumber: `98765432${i}` } }
      }
    }));
  }

  // 6 Students
  for (let i = 1; i <= 6; i++) {
    users.push(await prisma.user.create({
      data: { 
        email: `student${i}@breadtrans.com`, password: passwordHash, role: Role.STUDENT, 
        profile: { create: { fullName: `Student ${i}`, targetScore: `IELTS ${6.0 + i * 0.5}`, phone: `090123456${i}` } },
        stats: { create: { totalBanhRan: 1000 + i * 150, countHeart: 5, streakCount: i } },
        billing: { create: { tuitionFee: { "2026-08": { amount: 500000, paidAt: new Date().toISOString() } } } }
      }
    }));
  }

  const teachers = users.filter(u => u.role === Role.TEACHER);
  const students = users.filter(u => u.role === Role.STUDENT);

  // 2. Market Products
  const products = [];
  for (let i = 1; i <= 5; i++) {
    products.push(await prisma.marketProduct.create({
      data: {
        name: `Sản phẩm Cửa hàng ${i}`,
        price: 200 + i * 100,
        imageUrl: `https://example.com/product${i}.png`,
        order: i,
        purchaseCount: 0
      }
    }));
  }

  // 3. Vocab Topic & Words
  const vocabTopic = await prisma.vocabTopic.create({
    data: {
      title: 'Office Communication',
      categoryName: 'Business English',
      totalWords: 5,
      isPro: false,
      words: {
        create: [
          { word: 'Meeting', pos: 'noun', meaning: 'Cuộc họp', exampleEn: 'We have a meeting at 3 PM.' },
          { word: 'Agenda', pos: 'noun', meaning: 'Chương trình nghị sự', exampleEn: 'Let\'s review the agenda.' },
          { word: 'Colleague', pos: 'noun', meaning: 'Đồng nghiệp', exampleEn: 'He is my colleague.' },
          { word: 'Deadline', pos: 'noun', meaning: 'Hạn chót', exampleEn: 'The deadline is tomorrow.' },
          { word: 'Report', pos: 'noun', meaning: 'Báo cáo', exampleEn: 'Please submit the report.' }
        ]
      }
    }
  });

  // 4. TOEIC Exam
  const toeicExam = await prisma.toeicExamSet.create({
    data: {
      title: 'Đề thi TOEIC Rút gọn 2026',
      description: 'Mô phỏng đề thi thực tế (Rút gọn)',
      difficulty: 'Trung bình',
      createdBy: teachers[0].id,
      groups: {
        create: [
          {
            part: 1,
            groupOrder: 1,
            questions: {
              create: [
                {
                  questionNumber: 1,
                  text: 'What is the man doing?',
                  options: ['A', 'B', 'C', 'D'],
                  correctIndex: 0,
                  explanation: 'The man is standing by the desk.'
                }
              ]
            }
          }
        ]
      }
    }
  });

  // 5. Courses & Classes
  const courses = [];
  for (let i = 1; i <= 3; i++) {
    courses.push(await prisma.course.create({
      data: {
        title: `Khóa học Tiếng Anh Chuyên Sâu ${i}`,
        description: `Mô tả chi tiết cho khóa học ${i}`,
        price: 500000 + i * 50000,
        thumbnail: `https://example.com/course${i}.jpg`,
        status: CourseStatus.PUBLISHED
      }
    }));
  }

  const classes = [];
  for (let i = 0; i < 3; i++) {
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

  // 6. Enrollments
  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const cls = classes[i % classes.length];
    await prisma.enrollment.create({
      data: {
        userId: student.id,
        classId: cls.id,
        progress: Math.floor(Math.random() * 100),
      }
    });
  }

  // 7. Practice Quizzes
  const quiz = await prisma.quiz.create({
    data: {
      title: 'Đề thi trắc nghiệm mẫu',
      type: QuizType.TOEIC,
      questions: {
        create: [
          { type: 'MULTIPLE_CHOICE', order: 1, content: { text: `Câu hỏi mẫu?`, options: ['A', 'B', 'C', 'D'], correct: 'A' } }
        ]
      }
    }
  });

  // 8. Speaking Exercises
  await prisma.speakingExercise.create({ 
    data: { title: 'Basic Greetings', targetText: 'Hello! Nice to meet you!', difficulty: 'BEGINNER', category: 'GENERAL' } 
  });

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
