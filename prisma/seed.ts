import {
  AssignmentType,
  AttemptMode,
  AuthProvider,
  ClassStatus,
  CourseStatus,
  EnrollmentStatus,
  ExamType,
  PaymentStatus,
  PrismaClient,
  QuizType,
  Role,
  TopicCategory,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const PASSWORD = 'Password123!';

const videoUrls = [
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
  'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
];

async function main() {
  const password = await bcrypt.hash(PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@breadtrans.com' },
    update: { password, role: Role.ADMIN, emailVerifiedAt: new Date() },
    create: {
      email: 'admin@breadtrans.com',
      password,
      role: Role.ADMIN,
      emailVerifiedAt: new Date(),
      profile: {
        create: { fullName: 'BreadTrans Admin', isSelfClaimed: true },
      },
    },
  });

  const students = [];
  for (let index = 1; index <= 12; index += 1) {
    const student = await prisma.user.upsert({
      where: { email: `student${index}@breadtrans.com` },
      update: {
        password,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
        mustChangePassword: false,
      },
      create: {
        email: `student${index}@breadtrans.com`,
        password,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
        profile: {
          create: {
            fullName: `Học viên BreadTrans ${index}`,
            targetScore: index % 3 === 0 ? 'TOEIC 750+' : 'TOEIC 600+',
            birthYear: 2004 + (index % 5),
            isSelfClaimed: true,
          },
        },
      },
      include: { profile: true },
    });
    students.push(student);
    await prisma.userStats.upsert({
      where: { userId: student.id },
      update: {
        totalBanhRan: index * 35,
        streakCount: index % 7,
        quizAccuracy: 62 + index,
        speakingAccuracy: 5 + index / 2,
      },
      create: {
        userId: student.id,
        totalBanhRan: index * 35,
        streakCount: index % 7,
        quizAccuracy: 62 + index,
        speakingAccuracy: 5 + index / 2,
      },
    });
    await prisma.userPet.upsert({
      where: { userId: student.id },
      update: {
        name: index % 2 ? 'Bread' : 'Bun',
        level: 1 + (index % 4),
        exp: index * 20,
      },
      create: {
        userId: student.id,
        name: index % 2 ? 'Bread' : 'Bun',
        level: 1 + (index % 4),
        exp: index * 20,
      },
    });
    await prisma.leaderboard.upsert({
      where: { userId: student.id },
      update: {
        totalPoints: index * 125,
        weeklyExp: index * 18,
        rank: index,
        tier: index > 8 ? 'Bạc' : 'Đồng',
      },
      create: {
        userId: student.id,
        totalPoints: index * 125,
        weeklyExp: index * 18,
        rank: index,
        tier: index > 8 ? 'Bạc' : 'Đồng',
      },
    });
  }

  await prisma.authAccount.upsert({
    where: {
      provider_providerAccountId: {
        provider: AuthProvider.GOOGLE,
        providerAccountId: 'seed-google-student-1',
      },
    },
    update: { userId: students[0].id },
    create: {
      provider: AuthProvider.GOOGLE,
      providerAccountId: 'seed-google-student-1',
      userId: students[0].id,
    },
  });

  for (const user of [admin, ...students]) {
    await prisma.userBilling.upsert({
      where: { userId: user.id },
      update: {
        tuitionFee: { '2026-09': { amount: 1490000, paidAt: '2026-09-01' } },
      },
      create: {
        userId: user.id,
        tuitionFee: { '2026-09': { amount: 1490000, paidAt: '2026-09-01' } },
      },
    });
  }

  const courseDefinitions = [
    {
      id: 1,
      title: 'TOEIC Self-Paced Foundation',
      level: 'BEGINNER',
      status: CourseStatus.PUBLISHED,
      description:
        'Lộ trình nền tảng giúp người mới xây kỹ năng Nghe, Đọc và vốn từ TOEIC.',
      thumbnail: '/images/courses/toeic-foundation.jpg',
    },
    {
      id: 2,
      title: 'English Grammar Self-Paced',
      level: 'INTERMEDIATE',
      status: CourseStatus.PUBLISHED,
      description:
        'Ôn ngữ pháp theo chủ điểm, có ví dụ ngắn và bài luyện ngay sau mỗi phần.',
      thumbnail: '/images/courses/grammar.jpg',
    },
    {
      id: 3,
      title: 'TOEIC 4 Skills Accelerator',
      level: 'INTERMEDIATE',
      status: CourseStatus.PUBLISHED,
      description:
        'Lộ trình nâng tốc độ làm bài và củng cố chiến thuật TOEIC 4 kỹ năng.',
      thumbnail: '/images/courses/toeic-accelerator.jpg',
    },
    {
      id: 4,
      title: 'Business English Starter',
      level: 'BEGINNER',
      status: CourseStatus.DRAFT,
      description:
        'Từ vựng và mẫu câu tiếng Anh công sở theo tình huống thực tế.',
      thumbnail: '/images/courses/business.jpg',
    },
  ];
  const courses = [];
  for (const definition of courseDefinitions) {
    const { id, ...courseData } = definition;
    courses.push(
      await prisma.course.upsert({
        where: { id },
        update: courseData,
        create: { id, ...courseData },
      }),
    );
  }

  const offeringDefinitions = [
    {
      id: 1,
      courseId: courses[0].id,
      name: 'TOEIC Foundation - Open Access',
      capacity: 100,
      tuitionFeeVnd: 0,
      status: ClassStatus.UPCOMING,
    },
    {
      id: 2,
      courseId: courses[0].id,
      name: 'TOEIC Foundation - Guided Path',
      capacity: 30,
      tuitionFeeVnd: 1490000,
      status: ClassStatus.UPCOMING,
    },
    {
      id: 3,
      courseId: courses[1].id,
      name: 'Grammar Core - Self Study',
      capacity: 80,
      tuitionFeeVnd: 0,
      status: ClassStatus.ONGOING,
    },
    {
      id: 4,
      courseId: courses[2].id,
      name: 'TOEIC Accelerator - 2026',
      capacity: 25,
      tuitionFeeVnd: 2490000,
      status: ClassStatus.UPCOMING,
    },
    {
      id: 5,
      courseId: courses[3].id,
      name: 'Business English - Preview',
      capacity: 50,
      tuitionFeeVnd: 0,
      status: ClassStatus.UPCOMING,
    },
  ];
  const offerings = [];
  for (const [index, definition] of offeringDefinitions.entries()) {
    const offeringData = {
      courseId: definition.courseId,
      name: definition.name,
      capacity: definition.capacity,
      tuitionFeeVnd: definition.tuitionFeeVnd,
      status: definition.status,
    };
    offerings.push(
      await prisma.class.upsert({
        where: {
          courseId_name: {
            courseId: offeringData.courseId,
            name: offeringData.name,
          },
        },
        update: offeringData,
        create: {
          ...offeringData,
          startDate: new Date(
            `2026-${String(9 + (index % 3)).padStart(2, '0')}-15T08:00:00.000Z`,
          ),
          endDate: new Date(
            `2026-${String(11 + (index % 2)).padStart(2, '0')}-30T08:00:00.000Z`,
          ),
          summary: {
            format: 'self-paced',
            access: definition.tuitionFeeVnd === 0 ? 'free' : 'paid',
          },
        },
      }),
    );
  }

  let lessonId = 1;
  for (const course of courses) {
    for (let order = 1; order <= 8; order += 1) {
      const lesson = await prisma.lesson.upsert({
        where: { id: lessonId },
        update: {
          courseId: course.id,
          title: `Bài ${order}: ${course.title}`,
          order,
          videoUrl: videoUrls[(order - 1) % videoUrls.length],
        },
        create: {
          id: lessonId,
          courseId: course.id,
          title: `Bài ${order}: ${course.title}`,
          description: `Nội dung tự học số ${order}, học trong khoảng 10-15 phút.`,
          order,
          videoUrl: videoUrls[(order - 1) % videoUrls.length],
        },
      });
      await prisma.material.upsert({
        where: { id: lessonId },
        update: {
          lessonId: lesson.id,
          title: `Tài liệu tóm tắt bài ${order}`,
          fileUrl: `https://example.com/breadtrans/material-${lesson.id}.pdf`,
          fileType: 'PDF',
        },
        create: {
          id: lessonId,
          lessonId: lesson.id,
          title: `Tài liệu tóm tắt bài ${order}`,
          fileUrl: `https://example.com/breadtrans/material-${lesson.id}.pdf`,
          fileType: 'PDF',
        },
      });
      lessonId += 1;
    }
  }

  let assignmentId = 1;
  for (const [classIndex, offering] of offerings.entries()) {
    for (let assignmentIndex = 1; assignmentIndex <= 3; assignmentIndex += 1) {
      const type =
        assignmentIndex === 3 ? AssignmentType.ESSAY : AssignmentType.QUIZ;
      await prisma.assignment.upsert({
        where: { id: assignmentId },
        update: {
          classId: offering.id,
          title: `${type === AssignmentType.ESSAY ? 'Writing' : 'Quiz'} checkpoint ${assignmentIndex}`,
        },
        create: {
          id: assignmentId,
          classId: offering.id,
          title: `${type === AssignmentType.ESSAY ? 'Writing' : 'Quiz'} checkpoint ${assignmentIndex}`,
          description:
            type === AssignmentType.ESSAY
              ? 'Viết câu trả lời ngắn theo chủ đề bài học.'
              : 'Bài quiz kiểm tra nhanh sau mỗi module.',
          type,
          dueDate: new Date(
            `2026-${String(10 + (classIndex % 2)).padStart(2, '0')}-${String(10 + assignmentIndex).padStart(2, '0')}T23:59:00.000Z`,
          ),
          quizData:
            type === AssignmentType.QUIZ
              ? [
                  {
                    question: 'Which sentence is correct?',
                    options: [
                      'She go school.',
                      'She goes to school.',
                      'She going school.',
                      'She gone school.',
                    ],
                    correctOptionIndex: 1,
                  },
                  {
                    question: 'Choose the best answer.',
                    options: ['A', 'B', 'C', 'D'],
                    correctOptionIndex: assignmentIndex % 4,
                  },
                ]
              : undefined,
        },
      });
      assignmentId += 1;
    }
    await prisma.announcement.upsert({
      where: { id: classIndex + 1 },
      update: {
        classId: offering.id,
        title: 'Chào mừng bạn đến lộ trình tự học',
      },
      create: {
        id: classIndex + 1,
        classId: offering.id,
        title: 'Chào mừng bạn đến lộ trình tự học',
        content: 'Hãy bắt đầu bằng bài đầu tiên và duy trì nhịp học mỗi ngày.',
      },
    });
  }

  for (let index = 1; index <= 3; index += 1) {
    await prisma.assignmentSubmission.upsert({
      where: {
        assignmentId_userId: { assignmentId: index, userId: students[0].id },
      },
      update: {
        content: `Bài làm mẫu cho assignment ${index}`,
        grade: index === 3 ? 8.5 : 9,
        feedback: 'Bài làm tốt, hãy tiếp tục luyện tập đều đặn.',
        isPointsAwarded: true,
      },
      create: {
        assignmentId: index,
        userId: students[0].id,
        content: `Bài làm mẫu cho assignment ${index}`,
        quizAnswers: [1, 0],
        grade: index === 3 ? 8.5 : 9,
        feedback: 'Bài làm tốt, hãy tiếp tục luyện tập đều đặn.',
        isPointsAwarded: true,
      },
    });
  }

  let enrollmentIndex = 1;
  for (const [studentIndex, student] of students.entries()) {
    const freeOffering = offerings[studentIndex % 2 === 0 ? 0 : 2];
    await prisma.enrollment.upsert({
      where: {
        userId_classId: { userId: student.id, classId: freeOffering.id },
      },
      update: {
        status: EnrollmentStatus.ACTIVE,
        progress: Math.min(96, studentIndex * 7),
      },
      create: {
        userId: student.id,
        classId: freeOffering.id,
        status: EnrollmentStatus.ACTIVE,
        progress: Math.min(96, studentIndex * 7),
      },
    });
    if (studentIndex < 8) {
      const paidOffering = offerings[studentIndex % 2 === 0 ? 1 : 3];
      const status =
        studentIndex % 3 === 0
          ? EnrollmentStatus.COMPLETED
          : studentIndex % 3 === 1
            ? EnrollmentStatus.PENDING_PAYMENT
            : EnrollmentStatus.ACTIVE;
      const enrollment = await prisma.enrollment.upsert({
        where: {
          userId_classId: { userId: student.id, classId: paidOffering.id },
        },
        update: {
          status,
          progress:
            status === EnrollmentStatus.COMPLETED ? 100 : studentIndex * 5,
        },
        create: {
          userId: student.id,
          classId: paidOffering.id,
          status,
          progress:
            status === EnrollmentStatus.COMPLETED ? 100 : studentIndex * 5,
        },
      });
      await prisma.payment.upsert({
        where: { enrollmentId: enrollment.id },
        update: {
          amountVnd: paidOffering.tuitionFeeVnd,
          status:
            status === EnrollmentStatus.PENDING_PAYMENT
              ? PaymentStatus.PENDING
              : PaymentStatus.CONFIRMED,
        },
        create: {
          enrollmentId: enrollment.id,
          amountVnd: paidOffering.tuitionFeeVnd,
          transferCode: `BT-SEED-${String(enrollmentIndex).padStart(4, '0')}`,
          status:
            status === EnrollmentStatus.PENDING_PAYMENT
              ? PaymentStatus.PENDING
              : PaymentStatus.CONFIRMED,
        },
      });
      enrollmentIndex += 1;
    }
  }

  const practiceTopics = [
    ['Grammar Basics', 'Ngữ pháp nền tảng', TopicCategory.GRAMMAR_TOPIC],
    [
      'Grammar Mock Test',
      'Mini test ngữ pháp',
      TopicCategory.GRAMMAR_MOCK_TEST,
    ],
    ['Bilingual Reading A2', 'Đọc song ngữ A2', TopicCategory.BILINGUAL_LEVEL],
    ['Writing Part 1', 'Luyện viết Part 1', TopicCategory.WRITING_PART1],
  ] as const;
  for (let index = 0; index < practiceTopics.length; index += 1) {
    await prisma.practiceTopic.upsert({
      where: { id: index + 1 },
      update: {
        name: practiceTopics[index][0],
        vietnameseName: practiceTopics[index][1],
        category: practiceTopics[index][2],
      },
      create: {
        id: index + 1,
        name: practiceTopics[index][0],
        vietnameseName: practiceTopics[index][1],
        category: practiceTopics[index][2],
        order: index + 1,
      },
    });
  }

  const quizDefinitions = [
    [
      1,
      'TOEIC Listening Mini Practice',
      QuizType.LISTENING_PRACTICE,
      'Luyện nghe Part 1-2 trong 10 phút.',
    ],
    [
      2,
      'Bilingual Reading Daily',
      QuizType.BILINGUAL_READING,
      'Đọc đoạn văn ngắn và kiểm tra ý chính.',
    ],
    [
      3,
      'Writing Picture Prompt',
      QuizType.WRITING_PICTURE,
      'Viết mô tả tranh theo gợi ý.',
    ],
    [
      4,
      'TOEIC Foundation Quiz',
      QuizType.TOEIC,
      'Mini test tổng hợp cho người mới.',
    ],
  ] as const;
  let questionId = 1;
  for (const [id, title, type, description] of quizDefinitions) {
    const quiz = await prisma.quiz.upsert({
      where: { id },
      update: { title, type, description },
      create: {
        id,
        title,
        type,
        description,
        practiceTopicId: id <= 3 ? id : undefined,
        courseId: id === 4 ? courses[0].id : undefined,
        timeLimit: 10,
      },
    });
    for (let order = 1; order <= 5; order += 1) {
      await prisma.question.upsert({
        where: { id: questionId },
        update: { quizId: quiz.id, order },
        create: {
          id: questionId,
          quizId: quiz.id,
          type:
            type === QuizType.WRITING_PICTURE ? 'WRITING' : 'MULTIPLE_CHOICE',
          order,
          content: {
            text: `Question ${order}: choose the best answer.`,
            options: ['A', 'B', 'C', 'D'],
            correctIndex: order % 4,
          },
        },
      });
      questionId += 1;
    }
  }

  const toeicPaperDefinitions = [
    {
      id: 5,
      title: 'TOEIC 2 kỹ năng - Listening & Reading Mock 01',
      description:
        'Đề thi thử TOEIC 2 kỹ năng, tập trung Listening và Reading.',
      examFormat: 'TWO_SKILL',
      skillLabel: '2 kỹ năng',
      sections: ['LISTENING', 'READING'],
      durationMinutes: 120,
    },
    {
      id: 6,
      title: 'TOEIC 2 kỹ năng - Listening & Reading Mock 02',
      description:
        'Đề luyện tổng hợp Listening và Reading theo định dạng TOEIC.',
      examFormat: 'TWO_SKILL',
      skillLabel: '2 kỹ năng',
      sections: ['LISTENING', 'READING'],
      durationMinutes: 120,
    },
    {
      id: 7,
      title: 'TOEIC 4 kỹ năng - Full Skills Mock 01',
      description: 'Bộ đề mô phỏng đủ Listening, Reading, Speaking và Writing.',
      examFormat: 'FOUR_SKILL',
      skillLabel: '4 kỹ năng',
      sections: ['LISTENING', 'READING', 'SPEAKING', 'WRITING'],
      durationMinutes: 180,
    },
    {
      id: 8,
      title: 'TOEIC 4 kỹ năng - Full Skills Mock 02',
      description: 'Đề thi thử 4 kỹ năng với tình huống giao tiếp công sở.',
      examFormat: 'FOUR_SKILL',
      skillLabel: '4 kỹ năng',
      sections: ['LISTENING', 'READING', 'SPEAKING', 'WRITING'],
      durationMinutes: 180,
    },
    {
      id: 9,
      title: 'TOEIC 2 kỹ năng - Part 5 & Listening Challenge',
      description:
        'Bài luyện tăng tốc ngữ pháp Reading và bắt từ khóa Listening.',
      examFormat: 'TWO_SKILL',
      skillLabel: '2 kỹ năng',
      sections: ['LISTENING', 'READING'],
      durationMinutes: 90,
    },
    {
      id: 10,
      title: 'TOEIC 4 kỹ năng - Workplace Communication Test',
      description: 'Đề thực hành tiếng Anh công sở đủ 4 kỹ năng.',
      examFormat: 'FOUR_SKILL',
      skillLabel: '4 kỹ năng',
      sections: ['LISTENING', 'READING', 'SPEAKING', 'WRITING'],
      durationMinutes: 180,
    },
  ] as const;

  type SeedToeicQuestion = {
    section: 'LISTENING' | 'READING' | 'SPEAKING' | 'WRITING';
    text: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    audioText?: string;
  };

  const toeicPaperQuestionBanks: Record<number, SeedToeicQuestion[]> = {
    5: [
      {
        section: 'LISTENING',
        audioText: 'The marketing meeting has been moved to Thursday morning.',
        text: 'What has changed?',
        options: [
          'The meeting location',
          'The meeting time',
          'The meeting leader',
          'The meeting topic',
        ],
        correctIndex: 1,
        explanation:
          'The speaker says the meeting was moved to Thursday morning, so its time changed.',
      },
      {
        section: 'LISTENING',
        audioText: 'Could you send me the revised invoice before noon?',
        text: 'What does the speaker want?',
        options: [
          'A revised schedule',
          'An invoice before noon',
          'A new supplier',
          'A payment receipt',
        ],
        correctIndex: 1,
        explanation:
          'The request is specifically for the revised invoice before noon.',
      },
      {
        section: 'LISTENING',
        audioText: 'The train to the airport leaves from platform six.',
        text: 'Where should the passenger go?',
        options: [
          'The airport terminal',
          'Platform six',
          'The ticket office',
          'The bus station',
        ],
        correctIndex: 1,
        explanation: 'The announcement clearly identifies platform six.',
      },
      {
        section: 'LISTENING',
        audioText: 'Ms. Tran will be out of the office until next Tuesday.',
        text: 'When will Ms. Tran return?',
        options: ['Tomorrow', 'This Friday', 'Next Tuesday', 'Next month'],
        correctIndex: 2,
        explanation: 'Until next Tuesday means she returns next Tuesday.',
      },
      {
        section: 'LISTENING',
        audioText:
          'Please place all outgoing packages beside the reception desk.',
        text: 'Where should the packages be placed?',
        options: [
          'In the storage room',
          'Beside reception',
          'At the loading dock',
          'On the manager’s desk',
        ],
        correctIndex: 1,
        explanation:
          'The speaker gives the location: beside the reception desk.',
      },
      {
        section: 'LISTENING',
        audioText:
          'I am calling to confirm your appointment at three thirty this afternoon.',
        text: 'Why is the caller calling?',
        options: [
          'To cancel an appointment',
          'To confirm an appointment',
          'To change an address',
          'To offer a discount',
        ],
        correctIndex: 1,
        explanation:
          'The caller explicitly says the purpose is to confirm the appointment.',
      },
      {
        section: 'READING',
        text: 'The annual report _____ by the finance team yesterday.',
        options: ['prepared', 'was prepared', 'is preparing', 'has prepare'],
        correctIndex: 1,
        explanation:
          'A completed passive action in the past requires “was prepared”.',
      },
      {
        section: 'READING',
        text: 'Employees should submit travel requests _____ Friday.',
        options: ['by', 'from', 'during', 'since'],
        correctIndex: 0,
        explanation: '“By Friday” gives a deadline.',
      },
      {
        section: 'READING',
        text: 'The new software is easier to use _____ the previous version.',
        options: ['than', 'then', 'that', 'as'],
        correctIndex: 0,
        explanation: 'Comparative adjective “easier” takes “than”.',
      },
      {
        section: 'READING',
        text: 'Please _____ the attached file before the meeting.',
        options: ['review', 'reviews', 'reviewed', 'reviewing'],
        correctIndex: 0,
        explanation: 'After “please”, use the base verb form.',
      },
      {
        section: 'READING',
        text: 'Our customers value prompt and _____ service.',
        options: ['reliable', 'reliably', 'reliability', 'rely'],
        correctIndex: 0,
        explanation: 'An adjective is needed before the noun “service”.',
      },
      {
        section: 'READING',
        text: 'The store will remain open _____ 9 P.M. on weekends.',
        options: ['until', 'among', 'within', 'beside'],
        correctIndex: 0,
        explanation: '“Until” indicates the closing time.',
      },
    ],
    6: [
      {
        section: 'LISTENING',
        audioText: 'Your package is scheduled for delivery on Monday.',
        text: 'When will the package arrive?',
        options: ['Today', 'Tomorrow', 'On Monday', 'Next month'],
        correctIndex: 2,
        explanation: 'The delivery date stated is Monday.',
      },
      {
        section: 'LISTENING',
        audioText: 'The cafeteria is closed today for equipment repairs.',
        text: 'Why is the cafeteria closed?',
        options: [
          'For a private event',
          'For staff training',
          'For equipment repairs',
          'For cleaning supplies',
        ],
        correctIndex: 2,
        explanation: 'The announcement gives equipment repairs as the reason.',
      },
      {
        section: 'LISTENING',
        audioText:
          'Would you like me to reserve a conference room for the presentation?',
        text: 'What is being offered?',
        options: [
          'A hotel reservation',
          'A room reservation',
          'A new presentation',
          'A printed report',
        ],
        correctIndex: 1,
        explanation: 'The speaker offers to reserve a conference room.',
      },
      {
        section: 'LISTENING',
        audioText: 'This flight is now boarding at gate twenty-two.',
        text: 'What should passengers do?',
        options: [
          'Collect their luggage',
          'Go to gate twenty-two',
          'Change their tickets',
          'Wait at the café',
        ],
        correctIndex: 1,
        explanation: 'Boarding is happening at gate twenty-two.',
      },
      {
        section: 'LISTENING',
        audioText:
          'I will email the contract as soon as the director signs it.',
        text: 'What will happen after the director signs?',
        options: [
          'The contract will be emailed',
          'The meeting will start',
          'The office will close',
          'The contract will be printed',
        ],
        correctIndex: 0,
        explanation: 'The speaker will email the contract after it is signed.',
      },
      {
        section: 'LISTENING',
        audioText:
          'The technician should arrive sometime between one and three.',
        text: 'When is the technician expected?',
        options: [
          'Before noon',
          'Between one and three',
          'At exactly three',
          'After five',
        ],
        correctIndex: 1,
        explanation: 'The expected arrival window is between one and three.',
      },
      {
        section: 'READING',
        text: 'The manager asked all staff _____ the safety training.',
        options: ['attend', 'to attend', 'attending', 'attended'],
        correctIndex: 1,
        explanation: '“Ask someone to do something” takes the infinitive.',
      },
      {
        section: 'READING',
        text: 'Neither the manager nor the assistants _____ available this afternoon.',
        options: ['is', 'are', 'was', 'be'],
        correctIndex: 1,
        explanation:
          'The verb agrees with the nearest plural subject “assistants”.',
      },
      {
        section: 'READING',
        text: 'Sales increased _____ fifteen percent last quarter.',
        options: ['by', 'for', 'with', 'at'],
        correctIndex: 0,
        explanation: 'Use “increase by” with the amount of change.',
      },
      {
        section: 'READING',
        text: 'The brochure provides _____ information about our services.',
        options: ['useful', 'usefully', 'use', 'used'],
        correctIndex: 0,
        explanation: 'An adjective modifies “information”.',
      },
      {
        section: 'READING',
        text: 'Ms. Lee has worked here _____ 2019.',
        options: ['for', 'since', 'during', 'until'],
        correctIndex: 1,
        explanation: 'Use “since” with a starting point in time.',
      },
      {
        section: 'READING',
        text: 'All visitors must wear a badge _____ entering the building.',
        options: ['before', 'although', 'because', 'unless'],
        correctIndex: 0,
        explanation: 'A badge is required before entering.',
      },
    ],
    7: [
      {
        section: 'LISTENING',
        audioText:
          'Please take a seat while I check the availability of the product.',
        text: 'What will the speaker do next?',
        options: [
          'Process a refund',
          'Check product availability',
          'Close the store',
          'Call a taxi',
        ],
        correctIndex: 1,
        explanation:
          'The speaker says they will check whether the product is available.',
      },
      {
        section: 'LISTENING',
        audioText:
          'The workshop begins at nine, but registration opens at eight thirty.',
        text: 'When does registration open?',
        options: ['At eight thirty', 'At nine', 'At noon', 'At five'],
        correctIndex: 0,
        explanation: 'Registration opens before the workshop, at 8:30.',
      },
      {
        section: 'LISTENING',
        audioText:
          'We need two more volunteers to help with the customer survey.',
        text: 'What is needed?',
        options: [
          'More customer surveys',
          'Two volunteers',
          'A new manager',
          'A larger office',
        ],
        correctIndex: 1,
        explanation: 'The speaker requests two additional volunteers.',
      },
      {
        section: 'READING',
        text: 'The company’s newest branch _____ in Da Nang last month.',
        options: ['opens', 'opened', 'was opening', 'has open'],
        correctIndex: 1,
        explanation: '“Last month” calls for the simple past tense.',
      },
      {
        section: 'READING',
        text: 'Customers can receive a discount _____ joining the loyalty program.',
        options: ['by', 'from', 'until', 'without'],
        correctIndex: 0,
        explanation: 'Use “by + gerund” to describe a method.',
      },
      {
        section: 'READING',
        text: 'The conference room is large enough _____ fifty people.',
        options: ['hold', 'to hold', 'holding', 'held'],
        correctIndex: 1,
        explanation: '“Enough to + verb” is the correct structure.',
      },
      {
        section: 'SPEAKING',
        text: 'A colleague asks: “Could you help me carry these boxes?” What is the best response?',
        options: [
          'Sure, I’ll help you with those.',
          'The boxes were delivered yesterday.',
          'I work in accounting.',
          'It is on the third floor.',
        ],
        correctIndex: 0,
        explanation:
          'The first response directly accepts the request politely.',
      },
      {
        section: 'SPEAKING',
        text: 'You are late for a meeting. Which sentence is most appropriate?',
        options: [
          'I apologize for being late.',
          'The meeting is a room.',
          'I will late yesterday.',
          'Please arrive the report.',
        ],
        correctIndex: 0,
        explanation: 'A clear apology is appropriate when arriving late.',
      },
      {
        section: 'SPEAKING',
        text: 'A client asks when a report will be ready. Choose the best reply.',
        options: [
          'It should be ready by Friday afternoon.',
          'The report is very blue.',
          'I am ready at the desk.',
          'Friday has many reports.',
        ],
        correctIndex: 0,
        explanation:
          'The first option directly and professionally answers the client’s question.',
      },
      {
        section: 'WRITING',
        text: 'Choose the best opening for a professional email to a customer.',
        options: [
          'Dear Ms. Nguyen,',
          'Hey customer!',
          'What is up?',
          'To whom it maybe concern',
        ],
        correctIndex: 0,
        explanation:
          '“Dear Ms. Nguyen,” is professional and correctly punctuated.',
      },
      {
        section: 'WRITING',
        text: 'Choose the most polite request.',
        options: [
          'Could you please review the attached proposal?',
          'Review this now.',
          'You must look proposal.',
          'Why you do not review it?',
        ],
        correctIndex: 0,
        explanation: '“Could you please…” is polite and grammatically correct.',
      },
      {
        section: 'WRITING',
        text: 'Choose the best closing sentence for an email.',
        options: [
          'Thank you for your time and consideration.',
          'Close this message now.',
          'I finish writing.',
          'You answer quickly.',
        ],
        correctIndex: 0,
        explanation:
          'The first sentence is a standard professional email closing.',
      },
    ],
    8: [
      {
        section: 'LISTENING',
        audioText:
          'The supplier has agreed to extend the payment deadline by ten days.',
        text: 'What did the supplier agree to do?',
        options: [
          'Reduce the price',
          'Extend the payment deadline',
          'Send more products',
          'Cancel the order',
        ],
        correctIndex: 1,
        explanation: 'The supplier agreed to give ten more days for payment.',
      },
      {
        section: 'LISTENING',
        audioText:
          'The museum tour starts near the main entrance at eleven o’clock.',
        text: 'Where will the tour begin?',
        options: [
          'At the café',
          'Near the main entrance',
          'In the parking lot',
          'At the ticket office',
        ],
        correctIndex: 1,
        explanation: 'The starting point is near the main entrance.',
      },
      {
        section: 'LISTENING',
        audioText: 'Please print the agenda in color for the board members.',
        text: 'How should the agenda be printed?',
        options: [
          'In black and white',
          'On both sides',
          'In color',
          'In a larger size',
        ],
        correctIndex: 2,
        explanation: 'The instruction is to print the agenda in color.',
      },
      {
        section: 'READING',
        text: 'The new policy will take effect _____ the first of July.',
        options: ['on', 'at', 'in', 'for'],
        correctIndex: 0,
        explanation: 'Use “on” with a specific date.',
      },
      {
        section: 'READING',
        text: 'Our team has completed the project _____ schedule.',
        options: ['ahead of', 'between', 'outside', 'beneath'],
        correctIndex: 0,
        explanation: 'The fixed expression is “ahead of schedule”.',
      },
      {
        section: 'READING',
        text: 'The receptionist will notify you _____ the visitor arrives.',
        options: ['when', 'than', 'while', 'because of'],
        correctIndex: 0,
        explanation: '“When” correctly introduces the arrival time.',
      },
      {
        section: 'SPEAKING',
        text: 'You need clarification during a presentation. Choose the best question.',
        options: [
          'Could you clarify the last point, please?',
          'You clarify last point.',
          'What last point means?',
          'Clarification is needed.',
        ],
        correctIndex: 0,
        explanation: 'The first option is polite, complete, and professional.',
      },
      {
        section: 'SPEAKING',
        text: 'A visitor asks for directions to the elevator. Choose the best response.',
        options: [
          'It is around the corner on your left.',
          'I elevate every day.',
          'The elevator has arrived yesterday.',
          'You are direction.',
        ],
        correctIndex: 0,
        explanation: 'The first response gives clear directions.',
      },
      {
        section: 'SPEAKING',
        text: 'Choose the best way to introduce yourself in a meeting.',
        options: [
          'Hello, I’m Mai from the sales department.',
          'I am department sales hello.',
          'Sales is my meeting.',
          'Hello department is Mai.',
        ],
        correctIndex: 0,
        explanation:
          'The first sentence is natural and suitable for a professional meeting.',
      },
      {
        section: 'WRITING',
        text: 'Choose the clearest subject line for an email about a postponed meeting.',
        options: [
          'Meeting Rescheduled: May 12',
          'Important Thing',
          'Hello Again',
          'Read This Today',
        ],
        correctIndex: 0,
        explanation: 'A useful subject line states the topic and the new date.',
      },
      {
        section: 'WRITING',
        text: 'Which sentence is grammatically correct?',
        options: [
          'Please let me know if you have any questions.',
          'Please let me know if you has questions.',
          'Please let me knowing your questions.',
          'Please let know me questions.',
        ],
        correctIndex: 0,
        explanation:
          'The first sentence uses the correct verb form and word order.',
      },
      {
        section: 'WRITING',
        text: 'Choose the best sentence for confirming a delivery.',
        options: [
          'We confirm that your order will arrive tomorrow.',
          'Your order arrive confirm tomorrow.',
          'We are confirm your order.',
          'Tomorrow is your order confirmed.',
        ],
        correctIndex: 0,
        explanation:
          'The first option is complete, clear, and grammatically correct.',
      },
    ],
    9: [
      {
        section: 'LISTENING',
        audioText:
          'The finance department will release the budget figures after lunch.',
        text: 'When will the budget figures be released?',
        options: [
          'Before lunch',
          'After lunch',
          'Tomorrow morning',
          'At the end of the month',
        ],
        correctIndex: 1,
        explanation:
          'The speaker says the figures will be released after lunch.',
      },
      {
        section: 'LISTENING',
        audioText:
          'Please contact the help desk if you cannot access the shared folder.',
        text: 'Whom should employees contact?',
        options: [
          'The finance department',
          'The help desk',
          'The client',
          'The delivery driver',
        ],
        correctIndex: 1,
        explanation: 'The instruction is to contact the help desk.',
      },
      {
        section: 'LISTENING',
        audioText:
          'The restaurant is offering a free dessert with every dinner order tonight.',
        text: 'What is being offered?',
        options: [
          'A free drink',
          'A free dessert',
          'A dinner discount',
          'A free breakfast',
        ],
        correctIndex: 1,
        explanation: 'Each dinner order includes a free dessert.',
      },
      {
        section: 'LISTENING',
        audioText: 'The copy machine on the second floor is out of service.',
        text: 'What is the problem?',
        options: [
          'The floor is closed',
          'The copy machine is not working',
          'The machine is on sale',
          'The elevator is broken',
        ],
        correctIndex: 1,
        explanation: '“Out of service” means the copy machine is not working.',
      },
      {
        section: 'READING',
        text: 'The candidate _____ extensive experience in customer support.',
        options: ['has', 'have', 'having', 'to have'],
        correctIndex: 0,
        explanation: 'The singular subject “candidate” takes “has”.',
      },
      {
        section: 'READING',
        text: 'Please make sure that every form is _____ completed.',
        options: ['fully', 'full', 'fulfill', 'fullness'],
        correctIndex: 0,
        explanation: 'An adverb is needed to modify “completed”.',
      },
      {
        section: 'READING',
        text: 'The director was impressed _____ the team’s presentation.',
        options: ['by', 'at', 'from', 'for'],
        correctIndex: 0,
        explanation: 'The fixed phrase is “impressed by”.',
      },
      {
        section: 'READING',
        text: 'If the shipment arrives early, we _____ you immediately.',
        options: ['will notify', 'notified', 'are notifying', 'have notify'],
        correctIndex: 0,
        explanation: 'The first conditional uses “will” in the main clause.',
      },
      {
        section: 'READING',
        text: 'This offer is valid _____ the end of the month.',
        options: ['through', 'between', 'near', 'among'],
        correctIndex: 0,
        explanation:
          '“Through the end of the month” means until the month ends.',
      },
      {
        section: 'READING',
        text: 'The company is looking for a _____ assistant.',
        options: ['reliable', 'reliably', 'reliability', 'rely'],
        correctIndex: 0,
        explanation: 'An adjective is required before the noun “assistant”.',
      },
      {
        section: 'READING',
        text: 'The office will be closed _____ the national holiday.',
        options: ['because of', 'although', 'despite', 'however'],
        correctIndex: 0,
        explanation:
          '“Because of” is followed by the noun phrase “the national holiday”.',
      },
      {
        section: 'READING',
        text: 'We have not received the signed agreement _____.',
        options: ['yet', 'already', 'still', 'ever'],
        correctIndex: 0,
        explanation:
          '“Yet” is used in negative statements about something expected to happen.',
      },
    ],
    10: [
      {
        section: 'LISTENING',
        audioText:
          'The client would like to discuss the proposal over a video call tomorrow.',
        text: 'How does the client want to discuss the proposal?',
        options: [
          'By email',
          'Over a video call',
          'At a restaurant',
          'By postal mail',
        ],
        correctIndex: 1,
        explanation: 'The client requests a video call.',
      },
      {
        section: 'LISTENING',
        audioText:
          'Please remember to bring your identification card to the interview.',
        text: 'What should the applicant bring?',
        options: [
          'A portfolio',
          'An identification card',
          'A laptop',
          'A business card',
        ],
        correctIndex: 1,
        explanation:
          'The speaker specifically mentions an identification card.',
      },
      {
        section: 'LISTENING',
        audioText:
          'The maintenance team repaired the air conditioner this morning.',
        text: 'What was repaired?',
        options: [
          'The elevator',
          'The air conditioner',
          'The printer',
          'The lighting',
        ],
        correctIndex: 1,
        explanation: 'The maintenance team repaired the air conditioner.',
      },
      {
        section: 'READING',
        text: 'The manager will review the application _____ making a final decision.',
        options: ['before', 'while', 'although', 'despite'],
        correctIndex: 0,
        explanation: 'The review happens before the final decision.',
      },
      {
        section: 'READING',
        text: 'All attendees are encouraged to _____ questions after the session.',
        options: ['ask', 'asks', 'asked', 'asking'],
        correctIndex: 0,
        explanation: 'After “to”, use the base form “ask”.',
      },
      {
        section: 'READING',
        text: 'The company expanded its services _____ meet customer demand.',
        options: ['to', 'for', 'by', 'with'],
        correctIndex: 0,
        explanation: 'Use “to + verb” to express purpose.',
      },
      {
        section: 'SPEAKING',
        text: 'A customer says a product is damaged. Choose the best response.',
        options: [
          'I’m sorry to hear that. Let me help you replace it.',
          'The product was damaged.',
          'You should buy a new store.',
          'Damage is not a customer.',
        ],
        correctIndex: 0,
        explanation:
          'The first response is empathetic and offers a practical solution.',
      },
      {
        section: 'SPEAKING',
        text: 'Choose the best sentence to ask for a meeting time.',
        options: [
          'Would Tuesday at 10 A.M. work for you?',
          'Tuesday work you ten?',
          'You are work Tuesday?',
          'Meeting time has Tuesday.',
        ],
        correctIndex: 0,
        explanation: 'The first option is polite and clearly proposes a time.',
      },
      {
        section: 'SPEAKING',
        text: 'A coworker thanks you for your help. Choose the best reply.',
        options: [
          'You’re welcome. I’m happy to help.',
          'I am thanks you.',
          'Help is welcome.',
          'You were happy.',
        ],
        correctIndex: 0,
        explanation: 'The first reply is natural and polite.',
      },
      {
        section: 'WRITING',
        text: 'Choose the best sentence to request a meeting agenda.',
        options: [
          'Could you send me the meeting agenda in advance?',
          'Send agenda me before.',
          'I request the agenda advance.',
          'Meeting agenda is send.',
        ],
        correctIndex: 0,
        explanation: 'The first sentence is polite and grammatically correct.',
      },
      {
        section: 'WRITING',
        text: 'Which sentence is best for reporting a completed task?',
        options: [
          'I have completed the requested update.',
          'I completed request update have.',
          'The update completing me.',
          'Requested have completed.',
        ],
        correctIndex: 0,
        explanation:
          'The first sentence is clear and appropriate in a work update.',
      },
      {
        section: 'WRITING',
        text: 'Choose the best closing for a formal email.',
        options: ['Best regards,', 'See you maybe,', 'Bye now!', 'Finished,'],
        correctIndex: 0,
        explanation: '“Best regards,” is a standard formal email closing.',
      },
    ],
  };

  for (const paper of toeicPaperDefinitions) {
    const quiz = await prisma.quiz.upsert({
      where: { id: paper.id },
      update: {
        title: paper.title,
        description: paper.description,
        type: QuizType.TOEIC,
        bilingualContent: {
          examFormat: paper.examFormat,
          skillLabel: paper.skillLabel,
          sections: paper.sections,
          durationMinutes: paper.durationMinutes,
        },
        timeLimit: paper.durationMinutes,
      },
      create: {
        id: paper.id,
        title: paper.title,
        description: paper.description,
        type: QuizType.TOEIC,
        bilingualContent: {
          examFormat: paper.examFormat,
          skillLabel: paper.skillLabel,
          sections: paper.sections,
          durationMinutes: paper.durationMinutes,
        },
        timeLimit: paper.durationMinutes,
      },
    });

    for (const [index, question] of toeicPaperQuestionBanks[
      paper.id
    ].entries()) {
      const order = index + 1;
      const content = {
        section: question.section,
        text: question.text,
        options: question.options,
        correct: question.options[question.correctIndex],
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        ...(question.audioText ? { audioText: question.audioText } : {}),
      };
      await prisma.question.upsert({
        where: { id: questionId },
        update: {
          quizId: quiz.id,
          type: 'MULTIPLE_CHOICE',
          order,
          content,
        },
        create: {
          id: questionId,
          quizId: quiz.id,
          type: 'MULTIPLE_CHOICE',
          order,
          content,
        },
      });
      questionId += 1;
    }
  }

  for (let index = 0; index < 4; index += 1) {
    const submissionId = 200 + index;
    await prisma.submission.upsert({
      where: { id: submissionId },
      update: {
        quizId: index + 1,
        userId: students[index].id,
        score: 7.5 + index / 2,
        aiFeedback: 'Phân tích tự động: tiếp tục củng cố từ vựng theo chủ đề.',
      },
      create: {
        id: submissionId,
        quizId: index + 1,
        userId: students[index].id,
        score: 7.5 + index / 2,
        aiFeedback: 'Phân tích tự động: tiếp tục củng cố từ vựng theo chủ đề.',
      },
    });
    await prisma.result.upsert({
      where: { id: submissionId },
      update: {
        submissionId,
        questionId: index * 5 + 1,
        answer: { selectedIndex: 1 },
        isCorrect: true,
        score: 1,
      },
      create: {
        id: submissionId,
        submissionId,
        questionId: index * 5 + 1,
        answer: { selectedIndex: 1 },
        isCorrect: true,
        score: 1,
      },
    });
  }

  const badges = [
    [
      1,
      'First Step',
      'Hoàn thành bài học đầu tiên',
      { type: 'LESSON', threshold: 1 },
    ],
    [
      2,
      'Seven Day Streak',
      'Duy trì streak 7 ngày',
      { type: 'STREAK', threshold: 7 },
    ],
    [3, 'Quiz Explorer', 'Hoàn thành 10 quiz', { type: 'QUIZ', threshold: 10 }],
    [
      4,
      'Speaking Brave',
      'Nộp bài speaking đầu tiên',
      { type: 'SPEAKING', threshold: 1 },
    ],
  ] as const;
  for (const [id, name, description, criteria] of badges)
    await prisma.badge.upsert({
      where: { id },
      update: { name, description, criteria },
      create: { id, name, description, criteria },
    });
  for (const student of students) {
    await prisma.userBadge.upsert({
      where: { userId_badgeId: { userId: student.id, badgeId: 1 } },
      update: {},
      create: { userId: student.id, badgeId: 1 },
    });
    await prisma.pointHistory.upsert({
      where: { id: 1000 + student.id },
      update: {
        userId: student.id,
        points: 25,
        reason: 'Seed: hoàn thành bài học',
      },
      create: {
        id: 1000 + student.id,
        userId: student.id,
        points: 25,
        reason: 'Seed: hoàn thành bài học',
      },
    });
  }

  const speakingExercises = [
    ['Read the sentence', 'The meeting starts at nine o’clock.', 'BEGINNER'],
    [
      'Describe the picture',
      'There are several people working in an office.',
      'INTERMEDIATE',
    ],
    [
      'Respond to the question',
      'What do you usually do after work?',
      'ADVANCED',
    ],
  ];
  for (let index = 0; index < speakingExercises.length; index += 1)
    await prisma.speakingExercise.upsert({
      where: { id: index + 1 },
      update: {
        title: speakingExercises[index][0],
        targetText: speakingExercises[index][1],
        difficulty: speakingExercises[index][2],
      },
      create: {
        id: index + 1,
        title: speakingExercises[index][0],
        targetText: speakingExercises[index][1],
        difficulty: speakingExercises[index][2],
        category: 'TOEIC',
      },
    });
  for (let index = 0; index < 3; index += 1) {
    await prisma.speakingSubmission.upsert({
      where: { id: 300 + index },
      update: {
        exerciseId: index + 1,
        userId: students[index].id,
        audioUrl: `https://example.com/breadtrans/audio-${index + 1}.webm`,
        overallScore: 7 + index / 2,
        aiFeedback: { pronunciation: 'clear', advice: 'Practice word stress.' },
      },
      create: {
        id: 300 + index,
        exerciseId: index + 1,
        userId: students[index].id,
        audioUrl: `https://example.com/breadtrans/audio-${index + 1}.webm`,
        overallScore: 7 + index / 2,
        aiFeedback: { pronunciation: 'clear', advice: 'Practice word stress.' },
      },
    });
  }

  const vocabTopics = [
    'Contracts',
    'Marketing',
    'Conferences',
    'Office Technology',
    'Business Planning',
    'Travel',
  ];
  let vocabWordId = 1;
  for (let topicIndex = 0; topicIndex < vocabTopics.length; topicIndex += 1) {
    const topic = await prisma.vocabTopic.upsert({
      where: { id: topicIndex + 1 },
      update: {
        title: vocabTopics[topicIndex],
        totalWords: 12,
        isPro: topicIndex > 3,
      },
      create: {
        id: topicIndex + 1,
        title: vocabTopics[topicIndex],
        totalWords: 12,
        isPro: topicIndex > 3,
      },
    });
    for (let wordIndex = 0; wordIndex < 12; wordIndex += 1) {
      await prisma.vocabWord.upsert({
        where: { id: vocabWordId },
        update: {
          topicId: topic.id,
          word: `${vocabTopics[topicIndex].toLowerCase()}-${wordIndex + 1}`,
          meaning: `Từ vựng ${vocabTopics[topicIndex]} số ${wordIndex + 1}`,
        },
        create: {
          id: vocabWordId,
          topicId: topic.id,
          word: `${vocabTopics[topicIndex].toLowerCase()}-${wordIndex + 1}`,
          meaning: `Từ vựng ${vocabTopics[topicIndex]} số ${wordIndex + 1}`,
          pos: wordIndex % 3 === 0 ? 'verb' : 'noun',
          ipaUs: `/ˈwɜːrd${wordIndex + 1}/`,
          exampleEn: `This is an example for ${vocabTopics[topicIndex]}.`,
          exampleVi: `Đây là ví dụ cho chủ đề ${vocabTopics[topicIndex]}.`,
          order: wordIndex + 1,
        },
      });
      if (students[0] && wordIndex < 3)
        await prisma.userVocabWordProgress.upsert({
          where: {
            userId_wordId: { userId: students[0].id, wordId: vocabWordId },
          },
          update: { reviewCount: wordIndex + 1, isMastered: wordIndex === 0 },
          create: {
            userId: students[0].id,
            wordId: vocabWordId,
            reviewCount: wordIndex + 1,
            isMastered: wordIndex === 0,
          },
        });
      vocabWordId += 1;
    }
  }

  const grammarTopics = [
    'Present Simple',
    'Past Simple',
    'Present Perfect',
    'Modal Verbs',
    'Conditionals',
    'Comparatives',
  ];
  let grammarQuestionId = 1;
  for (let topicIndex = 0; topicIndex < grammarTopics.length; topicIndex += 1) {
    const topic = await prisma.grammarTopic.upsert({
      where: { id: topicIndex + 1 },
      update: {
        title: grammarTopics[topicIndex],
        level: topicIndex < 2 ? 'BEGINNER' : 'INTERMEDIATE',
      },
      create: {
        id: topicIndex + 1,
        title: grammarTopics[topicIndex],
        level: topicIndex < 2 ? 'BEGINNER' : 'INTERMEDIATE',
        description: `Lý thuyết và bài tập về ${grammarTopics[topicIndex]}.`,
        keyFormula: 'Subject + verb + object',
        order: topicIndex + 1,
      },
    });
    for (let questionIndex = 0; questionIndex < 5; questionIndex += 1) {
      await prisma.grammarQuestion.upsert({
        where: { id: grammarQuestionId },
        update: {
          topicId: topic.id,
          question: `Choose the correct ${grammarTopics[topicIndex]} sentence ${questionIndex + 1}.`,
        },
        create: {
          id: grammarQuestionId,
          topicId: topic.id,
          question: `Choose the correct ${grammarTopics[topicIndex]} sentence ${questionIndex + 1}.`,
          options: [
            'I study English.',
            'I studies English.',
            'I studying English.',
            'I studied English tomorrow.',
          ],
          correctIndex: 0,
          explanation: 'Chủ ngữ và thì cần phù hợp với cấu trúc câu.',
        },
      });
      grammarQuestionId += 1;
    }
  }
  for (let index = 0; index < 3; index += 1) {
    await prisma.grammarAttempt.upsert({
      where: { id: 400 + index },
      update: {
        userId: students[index].id,
        topicId: index + 1,
        score: 70 + index * 8,
        answers: { correct: 4, total: 5 },
      },
      create: {
        id: 400 + index,
        userId: students[index].id,
        topicId: index + 1,
        score: 70 + index * 8,
        answers: { correct: 4, total: 5 },
      },
    });
    await prisma.userGrammarReward.upsert({
      where: {
        userId_topicId: { userId: students[index].id, topicId: index + 1 },
      },
      update: {},
      create: { userId: students[index].id, topicId: index + 1 },
    });
  }

  const toeicExam = await prisma.toeicExamSet.upsert({
    where: { id: 1 },
    update: { title: 'TOEIC Mock Test 01', difficulty: 'medium' },
    create: {
      id: 1,
      title: 'TOEIC Mock Test 01',
      description: 'Bài thi thử TOEIC tổng hợp.',
      type: ExamType.FULL_TEST,
      difficulty: 'medium',
      createdBy: admin.id,
    },
  });
  let toeicQuestionId = 1;
  for (let part = 1; part <= 7; part += 1) {
    const group = await prisma.toeicQuestionGroup.upsert({
      where: { id: part },
      update: { examId: toeicExam.id, part },
      create: {
        id: part,
        examId: toeicExam.id,
        part,
        groupOrder: part,
        passageText: `TOEIC Part ${part} practice passage.`,
      },
    });
    for (let number = 1; number <= 4; number += 1) {
      await prisma.toeicQuestion.upsert({
        where: { id: toeicQuestionId },
        update: { groupId: group.id, questionNumber: number },
        create: {
          id: toeicQuestionId,
          groupId: group.id,
          questionNumber: number,
          text: `Part ${part} question ${number}`,
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          correctIndex: (number + part) % 4,
          explanation: 'Đọc kỹ từ khóa và ngữ cảnh trước khi chọn đáp án.',
        },
      });
      toeicQuestionId += 1;
    }
  }
  for (let index = 0; index < 4; index += 1) {
    const attempt = await prisma.toeicAttempt.upsert({
      where: { id: index + 1 },
      update: {
        userId: students[index].id,
        examId: toeicExam.id,
        totalScore: 450 + index * 55,
      },
      create: {
        id: index + 1,
        userId: students[index].id,
        examId: toeicExam.id,
        mode: index % 2 ? AttemptMode.FULL_TEST : AttemptMode.PRACTICE,
        listeningScore: 220 + index * 20,
        readingScore: 230 + index * 35,
        totalScore: 450 + index * 55,
        submittedAt: new Date(),
      },
    });
    await prisma.toeicAttemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId: 1 } },
      update: { selectedIndex: index % 4 },
      create: {
        attemptId: attempt.id,
        questionId: 1,
        selectedIndex: index % 4,
      },
    });
  }
  await prisma.toeicSpeakingWritingSubmission.upsert({
    where: { id: 500 },
    update: {
      userId: students[0].id,
      questionId: 1,
      audioUrl: 'https://example.com/breadtrans/toeic-speaking-1.webm',
      aiGradedScore: 7.5,
      aiTranscript: 'The office is busy today.',
      aiFeedback: { fluency: 8, grammar: 7 },
    },
    create: {
      id: 500,
      userId: students[0].id,
      questionId: 1,
      audioUrl: 'https://example.com/breadtrans/toeic-speaking-1.webm',
      textContent: 'The office is busy today.',
      aiGradedScore: 7.5,
      aiTranscript: 'The office is busy today.',
      aiFeedback: { fluency: 8, grammar: 7 },
      gradedAt: new Date(),
    },
  });

  const quests: Array<[string, string, string, number, number, number]> = [
    ['Học 10 từ vựng', 'Học từ mới trong Flashcard', 'DO_VOCAB', 10, 15, 5],
    [
      'Làm 1 bài luyện nghe',
      'Hoàn thành một bài nghe',
      'DO_LISTENING',
      1,
      20,
      8,
    ],
    [
      'Luyện Speaking',
      'Nộp một bài nói để nhận phản hồi',
      'DO_SPEAKING',
      1,
      25,
      10,
    ],
    ['Hoàn thành bài học', 'Xem xong một lesson', 'COMPLETE_LESSON', 1, 20, 8],
  ];
  for (let index = 0; index < quests.length; index += 1) {
    const quest = await prisma.dailyQuest.upsert({
      where: { id: index + 1 },
      update: {
        title: quests[index][0],
        description: quests[index][1],
        type: quests[index][2],
        targetValue: quests[index][3],
        rewardXP: quests[index][4],
        rewardBanh: quests[index][5],
      },
      create: {
        id: index + 1,
        title: quests[index][0],
        description: quests[index][1],
        type: quests[index][2],
        targetValue: quests[index][3],
        rewardXP: quests[index][4],
        rewardBanh: quests[index][5],
      },
    });
    await prisma.userQuestProgress.upsert({
      where: {
        userId_questId_dateKey: {
          userId: students[0].id,
          questId: quest.id,
          dateKey: '2026-09-08',
        },
      },
      update: { currentValue: index === 0 ? 6 : 0 },
      create: {
        userId: students[0].id,
        questId: quest.id,
        dateKey: '2026-09-08',
        currentValue: index === 0 ? 6 : 0,
      },
    });
  }

  const marketProducts: Array<[string, number, string]> = [
    ['Huy hiệu Ngôi Sao', 100, 'badge-star'],
    ['Khung avatar Cam', 180, 'frame-orange'],
    ['Vé bảo vệ streak', 250, 'streak-freeze'],
    ['Pet Bun hiếm', 500, 'pet-bun'],
  ];
  for (let index = 0; index < marketProducts.length; index += 1)
    await prisma.marketProduct.upsert({
      where: { id: index + 1 },
      update: {
        name: marketProducts[index][0],
        price: marketProducts[index][1],
        imageUrl: marketProducts[index][2],
      },
      create: {
        id: index + 1,
        name: marketProducts[index][0],
        price: marketProducts[index][1],
        imageUrl: marketProducts[index][2],
        stock: 100,
      },
    });
  await prisma.currencyTransaction.upsert({
    where: { id: 600 },
    update: {
      studentId: students[0].id,
      studentName: 'Học viên BreadTrans 1',
      userId: students[0].id,
      userName: 'student1@breadtrans.com',
      userRole: 'STUDENT',
      amount: 25,
      reason: 'Hoàn thành bài học',
      type: 'add',
    },
    create: {
      id: 600,
      studentId: students[0].id,
      studentName: 'Học viên BreadTrans 1',
      userId: students[0].id,
      userName: 'student1@breadtrans.com',
      userRole: 'STUDENT',
      amount: 25,
      reason: 'Hoàn thành bài học',
      type: 'add',
    },
  });
  await prisma.marketOrder.upsert({
    where: { id: 601 },
    update: {
      userId: students[0].id,
      studentName: 'Học viên BreadTrans 1',
      items: [{ productId: 1, quantity: 1 }],
      totalK: 0,
      totalBanh: 100,
      status: 'approved',
      currencyTxId: 600,
    },
    create: {
      id: 601,
      userId: students[0].id,
      studentName: 'Học viên BreadTrans 1',
      items: [{ productId: 1, quantity: 1 }],
      totalK: 0,
      totalBanh: 100,
      status: 'approved',
      currencyTxId: 600,
      paidAtCheckout: true,
      balanceAtCheckout: 125,
    },
  });
  await prisma.gameBattle.upsert({
    where: { roomId: 'seed-room-1' },
    update: {
      gameId: 'vocab-duel',
      p1Id: students[0].id,
      p2Id: students[1].id,
      stake: 10,
      status: 'settled',
      winnerRole: 'p1',
      winnerUserId: students[0].id,
      settledWinnerRole: 'p1',
      settledAt: new Date(),
    },
    create: {
      roomId: 'seed-room-1',
      gameId: 'vocab-duel',
      p1Id: students[0].id,
      p2Id: students[1].id,
      stake: 10,
      status: 'settled',
      winnerRole: 'p1',
      winnerUserId: students[0].id,
      settledWinnerRole: 'p1',
      settledAt: new Date(),
      escrowedAt: new Date(),
    },
  });

  await prisma.gameSettings.upsert({
    where: { gameId: 'flappy-bird' },
    update: { config: { enabled: true, rewardPerPoint: 1 } },
    create: {
      gameId: 'flappy-bird',
      config: { enabled: true, rewardPerPoint: 1 },
    },
  });
  await prisma.gameSettings.upsert({
    where: { gameId: 'shell-game' },
    update: { config: { enabled: true, maxReward: 50 } },
    create: { gameId: 'shell-game', config: { enabled: true, maxReward: 50 } },
  });
  for (let index = 0; index < 4; index += 1) {
    await prisma.gamePlay.upsert({
      where: { playToken: `seed-play-${index + 1}` },
      update: {
        userId: students[index].id,
        gameId: 'flappy-bird',
        status: 'finished',
        reward: 10 + index,
      },
      create: {
        playToken: `seed-play-${index + 1}`,
        userId: students[index].id,
        gameId: 'flappy-bird',
        status: 'finished',
        reward: 10 + index,
        result: { score: 100 + index * 25 },
      },
    });
  }

  for (const student of students.slice(0, 4)) {
    await prisma.watchTracking.upsert({
      where: { userId: student.id },
      update: {
        items: {
          '/seed/toeic-foundation-lesson-1.mp4': {
            played: 0.35,
            completed: false,
          },
        },
      },
      create: {
        userId: student.id,
        items: {
          '/seed/toeic-foundation-lesson-1.mp4': {
            played: 0.35,
            completed: false,
          },
        },
      },
    });
    await prisma.userBookProgress.upsert({
      where: {
        userId_bookId: { userId: student.id, bookId: 'toeic-foundation' },
      },
      update: {
        completedLessons: [1, 2],
        lessons: {
          '1': { progress: 1 },
          '2': { progress: 1 },
          '3': { progress: 0.35 },
        },
      },
      create: {
        userId: student.id,
        bookId: 'toeic-foundation',
        completedLessons: [1, 2],
        lessons: {
          '1': { progress: 1 },
          '2': { progress: 1 },
          '3': { progress: 0.35 },
        },
      },
    });
    await prisma.aiUsage.upsert({
      where: { userId_weekKey: { userId: student.id, weekKey: '2026-W37' } },
      update: { count: 2 },
      create: { userId: student.id, weekKey: '2026-W37', count: 2 },
    });
  }
  await prisma.speakingEvalRetry.upsert({
    where: { jobId: 'seed-speaking-retry-1' },
    update: {
      studentId: students[0].id,
      bookId: 'toeic-foundation',
      lessonId: 'lesson-1',
      audioUrl: 'https://example.com/breadtrans/retry-1.webm',
      status: 'resolved',
      retryCount: 1,
      resolvedAt: new Date(),
    },
    create: {
      jobId: 'seed-speaking-retry-1',
      studentId: students[0].id,
      bookId: 'toeic-foundation',
      lessonId: 'lesson-1',
      audioUrl: 'https://example.com/breadtrans/retry-1.webm',
      audioMimeType: 'audio/webm',
      recordedDurationSeconds: 18,
      referenceDurationSeconds: 16,
      script: 'The meeting starts at nine.',
      status: 'resolved',
      retryCount: 1,
      resolvedAt: new Date(),
    },
  });
  await prisma.pushSubscription.upsert({
    where: { endpoint: 'https://push.example.com/breadtrans/student1' },
    update: {
      userId: students[0].id,
      p256dh: 'seed-p256dh',
      auth: 'seed-auth',
      userAgent: 'Seed Browser',
    },
    create: {
      id: 700,
      userId: students[0].id,
      endpoint: 'https://push.example.com/breadtrans/student1',
      p256dh: 'seed-p256dh',
      auth: 'seed-auth',
      userAgent: 'Seed Browser',
    },
  });

  await prisma.contentTopic.upsert({
    where: { topicId: 'seed-movie-school' },
    update: { title: 'School Conversations' },
    create: {
      topicId: 'seed-movie-school',
      category: 'movie',
      title: 'School Conversations',
      order: 1,
      exercises: [{ prompt: 'Listen and repeat the sentence.' }],
    },
  });
  await prisma.contentTopic.upsert({
    where: { topicId: 'seed-music-daily' },
    update: { title: 'Daily English Songs' },
    create: {
      topicId: 'seed-music-daily',
      category: 'music',
      title: 'Daily English Songs',
      order: 2,
      exercises: [{ prompt: 'Fill in the missing word.' }],
    },
  });

  console.log(
    `Seed complete: 1 admin, ${students.length} students, ${courses.length} courses, ${offerings.length} offerings, ${lessonId - 1} lessons, ${assignmentId - 1} assignments, vocabulary/grammar/TOEIC/gamification data.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
