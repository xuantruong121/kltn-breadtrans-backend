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
        where: { id: definition.id },
        update: offeringData,
        create: {
          id: definition.id,
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
