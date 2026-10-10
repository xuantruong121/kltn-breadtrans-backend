import { PrismaClient } from '@prisma/client';
import { buildCourseCurriculum } from '../src/modules/course/course-curriculum';

type ActivitySpec = {
  courseId: number;
  lessonId: number;
  order: number;
  kind: 'LISTENING' | 'READING' | 'SPEAKING' | 'WRITING' | 'TOEIC' | 'GRAMMAR';
  title: string;
  isRequired: boolean;
  speakingPracticeSetId?: string;
  quizId?: number;
  toeicExamId?: number;
  grammarTopicId?: number;
};

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

const materialObjectives: Record<number, string> = {
  17: 'Build a Part 1–2 foundation with the real TOEIC practice engine.',
  18: 'Apply question–response strategies in a controlled TOEIC practice set.',
  19: 'Track speakers and details in TOEIC conversation tasks.',
  20: 'Understand short talks and announcements in TOEIC contexts.',
  21: 'Choose accurate grammar and vocabulary in incomplete sentences.',
  22: 'Use coherence and grammar to complete short workplace texts.',
  23: 'Connect information across TOEIC reading passages.',
  24: 'Finish a full TOEIC Listening and Reading milestone and review it.',
  25: 'Infer purpose, attitude and implied meaning at an advanced level.',
  26: 'Follow multi-speaker conversations and changing plans.',
  27: 'Process longer talks and linked information under time pressure.',
  28: 'Avoid frequent Part 5 grammar and collocation traps.',
  29: 'Use grammar and paragraph logic to complete Part 6 texts.',
  30: 'Read single workplace passages quickly and accurately.',
  31: 'Cross-reference evidence across multiple passages.',
  32: 'Complete an advanced mock milestone and review mistakes.',
  33: 'Read TOEIC prompts aloud with clear pronunciation and rhythm.',
  34: 'Describe a picture with an organized spoken response.',
  35: 'Respond to workplace questions with relevant details.',
  36: 'Use provided information to form accurate spoken answers.',
  37: 'Express an opinion with a reason and a concrete example.',
  38: 'Write accurate sentences from visual and lexical prompts.',
  39: 'Write a complete professional email response.',
  40: 'Write an organized opinion response with support.',
  41: 'Establish a baseline across the four skills.',
  42: 'Intensively practise workplace listening for details and intent.',
  43: 'Intensively practise reading for purpose, detail and inference.',
  44: 'Practise durable speaking responses in workplace contexts.',
  45: 'Practise writing tasks with clear organization and accuracy.',
  46: 'Transfer the four skills to one integrated workplace scenario.',
  47: 'Prepare a timed four-skill assessment using verified engines.',
  48: 'Complete the final four-skill capstone and review progress.',
  57: 'Use present and past forms in meaningful sentences.',
  58: 'Express future plans and completed experiences accurately.',
  59: 'Identify parts of speech in practical contexts.',
  60: 'Use modals for ability, obligation, advice and requests.',
  61: 'Recognize passive voice in notices and processes.',
  62: 'Choose real and hypothetical conditional forms.',
  63: 'Connect ideas with relative clauses and linking words.',
  64: 'Review high-frequency vocabulary in practical contexts.',
};

const grammarSeeds: Array<{
  lessonId: number;
  title: string;
  level: string;
  description: string;
  keyFormula: string;
  questions: Array<[string, string[], number]>;
}> = [
  {
    lessonId: 57,
    title: 'Present & Past Tenses',
    level: 'BEGINNER',
    description: 'Ôn hiện tại đơn, hiện tại tiếp diễn và quá khứ đơn.',
    keyFormula: 'Use the tense that matches the time and aspect of the action.',
    questions: [
      ['She ___ to work by bus every day.', ['go', 'goes', 'went', 'going'], 1],
      [
        'They ___ the report yesterday.',
        ['finish', 'finishes', 'finished', 'finishing'],
        2,
      ],
      ['I ___ dinner right now.', ['cook', 'cooked', 'am cooking', 'cooks'], 2],
    ],
  },
  {
    lessonId: 58,
    title: 'Future & Perfect Forms',
    level: 'INTERMEDIATE',
    description: 'Diễn tả kế hoạch, dự đoán và trải nghiệm đã hoàn tất.',
    keyFormula:
      'Use will for decisions/predictions and have + past participle for completed experience.',
    questions: [
      [
        'We ___ the client tomorrow.',
        ['visit', 'visited', 'will visit', 'visiting'],
        2,
      ],
      [
        'By Friday, she ___ the draft.',
        ['finishes', 'finished', 'will have finished', 'finish'],
        2,
      ],
      [
        'I ___ this software before.',
        ['use', 'used', 'have used', 'am using'],
        2,
      ],
    ],
  },
  {
    lessonId: 59,
    title: 'Parts of Speech',
    level: 'BEGINNER',
    description: 'Nhận diện danh từ, động từ, tính từ và trạng từ.',
    keyFormula: 'Identify the role a word plays in the sentence.',
    questions: [
      [
        'The manager spoke ___.',
        ['clear', 'clearly', 'clarity', 'clearest'],
        1,
      ],
      [
        'The team needs a quick ___.',
        ['decide', 'decision', 'decisive', 'decided'],
        1,
      ],
      ['This is a ___ proposal.', ['care', 'carefully', 'careful', 'cared'], 2],
    ],
  },
  {
    lessonId: 60,
    title: 'Modals & Requests',
    level: 'BEGINNER',
    description:
      'Dùng động từ khuyết thiếu trong yêu cầu và lời khuyên lịch sự.',
    keyFormula: 'Modal + base verb; could and would make requests more polite.',
    questions: [
      [
        'You ___ submit the form by Friday.',
        ['must', 'must to', 'musts', 'musted'],
        0,
      ],
      [
        '___ you send me the invoice?',
        ['Could', 'Must', 'Should to', 'Are'],
        0,
      ],
      [
        'You ___ check the address before sending it.',
        ['should', 'should to', 'shoulds', 'are'],
        0,
      ],
    ],
  },
  {
    lessonId: 61,
    title: 'Passive Voice',
    level: 'INTERMEDIATE',
    description: 'Nhận diện câu bị động trong thông báo và quy trình.',
    keyFormula: 'be + past participle focuses on the action or its result.',
    questions: [
      [
        'The package ___ yesterday.',
        ['delivers', 'was delivered', 'delivered', 'is delivering'],
        1,
      ],
      [
        'All invoices ___ by email.',
        ['send', 'are sent', 'sent', 'sending'],
        1,
      ],
      [
        'The room ___ before the meeting.',
        ['will clean', 'will be cleaned', 'cleaned', 'clean'],
        1,
      ],
    ],
  },
  {
    lessonId: 62,
    title: 'Conditionals',
    level: 'INTERMEDIATE',
    description: 'Phân biệt điều kiện thật và giả định.',
    keyFormula:
      'If + present, will + verb for likely results; if + past, would + verb for hypotheses.',
    questions: [
      [
        'If it rains, we ___ inside.',
        ['stay', 'will stay', 'stayed', 'would stayed'],
        1,
      ],
      [
        'If I had more time, I ___ another language.',
        ['learn', 'will learn', 'would learn', 'learned'],
        2,
      ],
      [
        'If you heat ice, it ___.',
        ['melts', 'will melt', 'melted', 'would melt'],
        0,
      ],
    ],
  },
  {
    lessonId: 63,
    title: 'Relative Clauses & Connectors',
    level: 'INTERMEDIATE',
    description: 'Nối ý và bổ sung thông tin cho danh từ.',
    keyFormula:
      'Use who/which/that for relative clauses and connectors for logical flow.',
    questions: [
      [
        'The colleague ___ called is waiting.',
        ['which', 'who', 'where', 'when'],
        1,
      ],
      [
        'The report was late; ___, the client accepted it.',
        ['however', 'because', 'unless', 'although'],
        0,
      ],
      [
        'This is the file ___ I requested.',
        ['who', 'where', 'that', 'when'],
        2,
      ],
    ],
  },
  {
    lessonId: 64,
    title: 'Vocabulary Review',
    level: 'BEGINNER',
    description: 'Ôn từ vựng tần suất cao trong ngữ cảnh thực tế.',
    keyFormula:
      'Use context, collocation and word form to select the best word.',
    questions: [
      [
        'Please ___ the meeting on your calendar.',
        ['schedule', 'schedules', 'scheduled', 'scheduling'],
        0,
      ],
      [
        'The new policy will ___ all employees.',
        ['affect', 'effect', 'effective', 'affects'],
        0,
      ],
      [
        'We need a ___ solution before Friday.',
        ['practice', 'practical', 'practically', 'practiced'],
        1,
      ],
    ],
  },
];

const activitySpecs: ActivitySpec[] = [
  {
    courseId: 3,
    lessonId: 17,
    order: 1,
    kind: 'TOEIC',
    title: 'TOEIC Practice by Part — Part 1–7',
    isRequired: true,
    toeicExamId: 2,
  },
  {
    courseId: 3,
    lessonId: 24,
    order: 1,
    kind: 'TOEIC',
    title: 'TOEIC Listening & Reading — Đề thi chuẩn 01',
    isRequired: true,
    toeicExamId: 1,
  },
  {
    courseId: 4,
    lessonId: 25,
    order: 1,
    kind: 'TOEIC',
    title: 'TOEIC Practice by Part — Part 1–7',
    isRequired: true,
    toeicExamId: 2,
  },
  {
    courseId: 4,
    lessonId: 32,
    order: 1,
    kind: 'TOEIC',
    title: 'TOEIC Listening & Reading — Đề thi chuẩn 01',
    isRequired: true,
    toeicExamId: 1,
  },
  {
    courseId: 5,
    lessonId: 33,
    order: 1,
    kind: 'SPEAKING',
    title: 'Read Aloud — TOEIC Context',
    isRequired: true,
    speakingPracticeSetId: 'read-aloud-toeic',
  },
  {
    courseId: 5,
    lessonId: 35,
    order: 1,
    kind: 'SPEAKING',
    title: 'Question Response — Workplace',
    isRequired: true,
    speakingPracticeSetId: 'question-response-business',
  },
  {
    courseId: 5,
    lessonId: 37,
    order: 1,
    kind: 'SPEAKING',
    title: 'Opinion — Workplace',
    isRequired: true,
    speakingPracticeSetId: 'opinion-business',
  },
  {
    courseId: 5,
    lessonId: 38,
    order: 1,
    kind: 'WRITING',
    title: 'Writing A2–B1 — Sentence Builder',
    isRequired: true,
    quizId: 3,
  },
  {
    courseId: 5,
    lessonId: 39,
    order: 1,
    kind: 'WRITING',
    title: 'Writing B1 — Professional Email',
    isRequired: true,
    quizId: 4,
  },
  {
    courseId: 6,
    lessonId: 41,
    order: 1,
    kind: 'READING',
    title: 'Reading A2 — Notices & Messages',
    isRequired: true,
    quizId: 2,
  },
  {
    courseId: 6,
    lessonId: 42,
    order: 1,
    kind: 'LISTENING',
    title: 'Listening B1 — Workplace Conversations',
    isRequired: true,
    quizId: 5,
  },
  {
    courseId: 6,
    lessonId: 43,
    order: 1,
    kind: 'READING',
    title: 'Reading B1 — Workplace Documents',
    isRequired: true,
    quizId: 6,
  },
  {
    courseId: 6,
    lessonId: 44,
    order: 1,
    kind: 'SPEAKING',
    title: 'Question Response — Workplace',
    isRequired: true,
    speakingPracticeSetId: 'question-response-business',
  },
  {
    courseId: 6,
    lessonId: 45,
    order: 1,
    kind: 'WRITING',
    title: 'Writing B1 — Professional Email',
    isRequired: true,
    quizId: 4,
  },
  {
    courseId: 6,
    lessonId: 48,
    order: 1,
    kind: 'TOEIC',
    title: 'TOEIC 4 Skills — Listening & Reading milestone',
    isRequired: false,
    toeicExamId: 1,
  },
  ...grammarSeeds.map((seed) => ({
    courseId: 8,
    lessonId: seed.lessonId,
    order: 1,
    kind: 'GRAMMAR' as const,
    title: seed.title,
    isRequired: true,
    grammarTopicId: 0,
  })),
];

async function ensureGrammarTopics() {
  const ids = new Map<number, number>();
  for (const seed of grammarSeeds) {
    let topic = await prisma.grammarTopic.findFirst({
      where: { title: seed.title },
      orderBy: { id: 'asc' },
    });
    if (!topic && apply) {
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"GrammarTopic"','id'), COALESCE((SELECT MAX("id") FROM "GrammarTopic"), 0) + 1, false)`,
      );
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"GrammarQuestion"','id'), COALESCE((SELECT MAX("id") FROM "GrammarQuestion"), 0) + 1, false)`,
      );
      topic = await prisma.grammarTopic.create({
        data: {
          title: seed.title,
          level: seed.level,
          description: seed.description,
          keyFormula: seed.keyFormula,
          order: seed.lessonId,
          questions: {
            create: seed.questions.map(
              ([question, options, correctIndex], index) => ({
                question,
                options,
                correctIndex,
                order: index + 1,
                explanation:
                  'Chọn đáp án phù hợp với cấu trúc và ngữ cảnh của câu.',
              }),
            ),
          },
        },
      });
    }
    if (topic) ids.set(seed.lessonId, topic.id);
    else ids.set(seed.lessonId, -seed.lessonId);
  }
  return ids;
}

async function upsertActivity(spec: ActivitySpec) {
  const where = {
    lessonId_order: { lessonId: spec.lessonId, order: spec.order },
  };
  const existing = await prisma.courseActivity.findUnique({ where });
  const data = {
    courseId: spec.courseId,
    lessonId: spec.lessonId,
    order: spec.order,
    kind: spec.kind,
    title: spec.title,
    isRequired: spec.isRequired,
    quizId: spec.quizId ?? null,
    speakingPracticeSetId: spec.speakingPracticeSetId ?? null,
    toeicExamId: spec.toeicExamId ?? null,
    grammarTopicId: spec.grammarTopicId ?? null,
  };
  if (existing) {
    const sameTarget =
      existing.courseId === spec.courseId &&
      existing.kind === spec.kind &&
      existing.quizId === data.quizId &&
      existing.speakingPracticeSetId === data.speakingPracticeSetId &&
      existing.toeicExamId === data.toeicExamId &&
      existing.grammarTopicId === data.grammarTopicId;
    if (!sameTarget)
      throw new Error(`Refusing to overwrite CourseActivity ${existing.id}`);
    if (apply)
      await prisma.courseActivity.update({ where: { id: existing.id }, data });
    return { id: existing.id, action: apply ? 'updated' : 'would-update' };
  }
  if (!apply) return { id: null, action: 'would-create' };
  const created = await prisma.courseActivity.create({ data });
  return { id: created.id, action: 'created' };
}

async function materialize() {
  if (apply) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"CourseActivity"','id'), COALESCE((SELECT MAX("id") FROM "CourseActivity"), 0) + 1, false)`,
    );
  }
  const topicIds = await ensureGrammarTopics();
  for (const spec of activitySpecs) {
    if (spec.courseId === 8) spec.grammarTopicId = topicIds.get(spec.lessonId);
    if (!spec.grammarTopicId && spec.kind === 'GRAMMAR')
      throw new Error(`Grammar topic missing for lesson ${spec.lessonId}`);
  }
  const results = [] as Array<Record<string, unknown>>;
  for (const spec of activitySpecs) {
    const result = await upsertActivity(spec);
    results.push({ ...spec, ...result });
  }

  const courses = await prisma.course.findMany({
    where: { id: { in: [3, 4, 5, 6, 8] } },
    include: {
      lessons: { include: { materials: true }, orderBy: { order: 'asc' } },
      quizzes: { include: { _count: { select: { questions: true } } } },
      activities: {
        include: {
          quiz: { include: { _count: { select: { questions: true } } } },
          speakingPracticeSet: {
            include: { exercises: { select: { id: true } } },
          },
          toeicExam: { include: { groups: { select: { id: true } } } },
          grammarTopic: { include: { questions: { select: { id: true } } } },
        },
        orderBy: { order: 'asc' },
      },
    },
  });
  const readiness = courses.map((course) => {
    const curriculum = buildCourseCurriculum(
      course.lessons,
      course.quizzes,
      course.activities,
      course.curriculumType,
    );
    return {
      id: course.id,
      title: course.title,
      readiness: curriculum.readiness,
      readinessReasons: curriculum.readinessReasons,
      requiredActivityCount: curriculum.requiredActivityCount,
      optionalActivityCount: curriculum.optionalActivityCount,
    };
  });
  if (apply) {
    for (const course of courses) {
      const info = readiness.find((row) => row.id === course.id);
      if (!info || !['READY', 'FOCUSED', 'TOEIC'].includes(info.readiness))
        throw new Error(
          `Course ${course.id} is not ready: ${JSON.stringify(info)}`,
        );
      await prisma.course.update({
        where: { id: course.id },
        data: { status: 'PUBLISHED' },
      });
      for (const lesson of course.lessons) {
        const objective = materialObjectives[lesson.id];
        if (!objective) continue;
        for (const material of lesson.materials) {
          const data: { objective?: string; contentText?: string } = {};
          if (!material.objective) data.objective = objective;
          if (!material.contentText) data.contentText = objective;
          if (Object.keys(data).length)
            await prisma.material.update({ where: { id: material.id }, data });
        }
      }
    }
  }
  return {
    mode: apply ? 'APPLY' : 'DRY_RUN',
    activityResults: results,
    readiness,
  };
}

materialize()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
