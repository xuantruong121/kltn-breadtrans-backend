/**
 * Idempotent reconstruction of the canonical TOEIC runtime layer.
 *
 * Why this exists
 * ---------------
 * `prisma/seed.ts` owns learning CONTENT (including `ToeicExamSet` 1 and 2)
 * but never creates the modern product/runtime layer, because those rows are
 * normally produced by the admin services at runtime:
 *
 *   Exam                      (generic product wrapper)
 *   ToeicAssessment           (+ ToeicAssessmentComponent rows)
 *   SpeakingPracticeSet       (EXAM_INTERNAL source, 11 tasks)
 *   ToeicWritingSet           (8 slots)
 *
 * After the 2026-10-23 database incident those rows were lost, so a fresh
 * reconstruction produced TOEIC content with no learner-facing product.
 * This script rebuilds that layer deterministically.
 *
 * Canonical identity
 * ------------------
 * `Exam` has no stable business key (only an autoincrement id), and no source
 * file hardcodes the historical ids 22/23 or assessments 15/16 — they were
 * incidental autoincrement values. Identity is therefore established by
 * canonical (familyCode, variantCode, title) lookup plus the unique
 * `ToeicExamSet.examId` link, never by hardcoded numeric ids.
 *
 * Idempotent: re-running makes no duplicates and preserves existing ids.
 *
 * Usage:
 *   npx ts-node scripts/reconstruct-canonical-toeic.ts
 *   npx ts-node scripts/reconstruct-canonical-toeic.ts --check
 */
import 'dotenv/config';
import {
  PrismaClient,
  QuizPublicationStatus,
  SpeakingPracticeScope,
  SpeakingStimulusKind,
  ToeicAssessmentComponentKind,
  ToeicAssessmentProductFamily,
} from '@prisma/client';
import { TOEIC_SPEAKING_TASK_SEQUENCE } from '../src/modules/speaking/toeic-speaking-contract';
import { TOEIC_WRITING_SLOT_CONTRACT } from '../src/modules/writing/toeic-writing-set.contract';

const checkOnly = process.argv.includes('--check');

/** Canonical titles are the stable identity used for find-or-create. */
const CANONICAL = {
  lr: {
    title: 'TOEIC 2 Skills: Listening & Reading — Đề luyện tập 01',
    familyCode: 'TOEIC',
    variantCode: 'TOEIC_LR',
    templateKey: 'TOEIC_LR_V1',
    seededExamSetId: 1,
  },
  sw: {
    title: 'TOEIC 2 Skills: Speaking & Writing — Đề luyện tập 01',
    familyCode: 'TOEIC',
    variantCode: 'TOEIC_SW',
    templateKey: 'TOEIC_SW_V1',
  },
  fourSkills: {
    title: 'TOEIC 4 Skills — Đề luyện tập 01',
    familyCode: 'TOEIC',
    variantCode: 'TOEIC_4_SKILLS',
    templateKey: 'TOEIC_4_SKILLS_V1',
  },
} as const;

/**
 * Original BreadTrans Speaking prompts. Order and task types follow
 * TOEIC_SPEAKING_TASK_SEQUENCE exactly; DESCRIBE_PICTURE slots reuse
 * already-verified R2 catalog images rather than generating new ones.
 */
const SPEAKING_TASKS: Array<{
  title: string;
  targetText: string;
  imageKey?: string;
  usesInformation?: boolean;
}> = [
  {
    title: 'Đọc to — Thông báo cửa hàng',
    targetText:
      'Thank you for shopping with us today. Our customer service desk is located on the second floor, next to the escalator, and it stays open until nine in the evening.',
  },
  {
    title: 'Đọc to — Thông báo chuyến bay',
    targetText:
      'Good afternoon, passengers. Boarding for flight two-one-four to Da Nang will begin in about fifteen minutes at gate seven. Please have your boarding pass ready.',
  },
  {
    title: 'Mô tả tranh — Văn phòng họp',
    targetText:
      'Describe the picture in as much detail as you can. Talk about the people, the place, and what is happening.',
    imageKey: 'catalog/toeic/shared/images/office-meeting.png',
  },
  {
    title: 'Mô tả tranh — Quầy cà phê',
    targetText:
      'Describe the picture in as much detail as you can. Mention where the people are and what they appear to be doing.',
    imageKey: 'catalog/toeic/shared/images/cafe-counter.png',
  },
  {
    title: 'Trả lời câu hỏi — Thói quen đi lại',
    targetText:
      'Imagine a transport company is asking about commuting habits. How do you usually travel to work or school, and how long does the trip take?',
  },
  {
    title: 'Trả lời câu hỏi — Mua sắm',
    targetText:
      'How often do you shop for groceries, and do you prefer a local market or a supermarket? Explain briefly.',
  },
  {
    title: 'Trả lời câu hỏi — Thời gian rảnh',
    targetText:
      'What do you usually do in your free time on weekends, and who do you spend that time with?',
  },
  {
    title: 'Trả lời bằng thông tin — Lịch hội thảo (câu 8)',
    targetText:
      'What time does the first session begin, and in which room is it held?',
    usesInformation: true,
  },
  {
    title: 'Trả lời bằng thông tin — Lịch hội thảo (câu 9)',
    targetText:
      'I heard the afternoon workshop was moved. Can you tell me who is leading it now?',
    usesInformation: true,
  },
  {
    title: 'Trả lời bằng thông tin — Lịch hội thảo (câu 10)',
    targetText:
      'Could you summarise the two sessions that take place after lunch, including their times?',
    usesInformation: true,
  },
  {
    title: 'Trình bày ý kiến — Làm việc từ xa',
    targetText:
      'Some companies allow employees to work from home two days a week. Do you think this is a good policy? Give reasons and examples to support your opinion.',
  },
];

/** Original BreadTrans Writing prompts matching TOEIC_WRITING_SLOT_CONTRACT. */
const WRITING_TASKS: Array<{
  title: string;
  prompt: string;
  imageKey?: string;
  keywords?: string[];
  email?: string;
}> = [
  {
    title: 'Viết câu theo tranh — Tủ tài liệu',
    prompt: 'Write ONE sentence about the picture using both keywords.',
    imageKey: 'catalog/toeic/shared/images/folders-cabinet.png',
    keywords: ['folder', 'shelf'],
  },
  {
    title: 'Viết câu theo tranh — Giao hàng',
    prompt: 'Write ONE sentence about the picture using both keywords.',
    imageKey: 'catalog/toeic/shared/images/delivery-boxes.png',
    keywords: ['box', 'deliver'],
  },
  {
    title: 'Viết câu theo tranh — Quầy thu ngân',
    prompt: 'Write ONE sentence about the picture using both keywords.',
    imageKey: 'catalog/toeic/shared/images/grocery-checkout.png',
    keywords: ['customer', 'pay'],
  },
  {
    title: 'Viết câu theo tranh — Bảng giờ khởi hành',
    prompt: 'Write ONE sentence about the picture using both keywords.',
    imageKey: 'catalog/toeic/shared/images/departure-board.png',
    keywords: ['passenger', 'schedule'],
  },
  {
    title: 'Viết câu theo tranh — Bãi để xe đạp',
    prompt: 'Write ONE sentence about the picture using both keywords.',
    imageKey: 'catalog/toeic/shared/images/bicycle-rack.png',
    keywords: ['bicycle', 'park'],
  },
  {
    title: 'Thư phản hồi — Dời lịch họp',
    prompt:
      'Read the e-mail from a colleague who needs to move a team meeting. Reply in at least 25 words: confirm a new time, suggest a room, and ask one question.',
    // The e-mail the prompt refers to (it was missing from the task).
    email:
      "From: Linh Tran\nSubject: Moving Thursday's team meeting\n\nHi, the project room is being repainted on Thursday, so I need to move our 10 a.m. team meeting. Could you tell me a time on Friday that works for you and which room we could use instead? Thanks, Linh",
  },
  {
    title: 'Thư phản hồi — Khiếu nại đơn hàng',
    prompt:
      'A customer writes that part of their order is missing. Reply in at least 25 words: apologise, explain the next step, and request one piece of information.',
    email:
      'From: Mark Davis\nSubject: Missing item in order #4821\n\nHello, my order arrived yesterday, but the desk lamp was not in the box. The other items were in good condition. Please let me know what you will do about the missing lamp. Regards, Mark Davis',
  },
  {
    title: 'Bài luận ý kiến — Học trực tuyến',
    prompt:
      'Do you agree or disagree that online courses are as effective as classroom lessons for learning English? Write at least 150 words with reasons and examples.',
  },
];

function publicUrl(key: string) {
  const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/${key}` : null;
}

async function main() {
  const prisma = new PrismaClient();
  const summary: Record<string, unknown> = {};
  try {
    // ---------------------------------------------------------------- L&R
    // The seeded ToeicExamSet 1 holds the 200 questions; it only needs an
    // owning Exam. Identity comes from the unique ToeicExamSet.examId link.
    const seededLr = await prisma.toeicExamSet.findUnique({
      where: { id: CANONICAL.lr.seededExamSetId },
      include: { genericExam: true },
    });
    if (!seededLr)
      throw new Error(
        `Seeded ToeicExamSet ${CANONICAL.lr.seededExamSetId} is missing — run the seed first.`,
      );

    let lrExam = seededLr.genericExam;
    if (!lrExam) {
      const existing = await prisma.exam.findFirst({
        where: {
          familyCode: CANONICAL.lr.familyCode,
          variantCode: CANONICAL.lr.variantCode,
          title: CANONICAL.lr.title,
        },
      });
      if (checkOnly) {
        summary.lrExam = existing
          ? `would reuse #${existing.id}`
          : 'would create';
      } else {
        lrExam =
          existing ??
          (await prisma.exam.create({
            data: {
              title: CANONICAL.lr.title,
              description: seededLr.description,
              familyCode: CANONICAL.lr.familyCode,
              variantCode: CANONICAL.lr.variantCode,
              templateKey: CANONICAL.lr.templateKey,
              createdBy: seededLr.createdBy,
              publicationStatus: QuizPublicationStatus.DRAFT,
            },
          }));
        await prisma.toeicExamSet.update({
          where: { id: seededLr.id },
          data: { examId: lrExam.id },
        });
      }
    }
    summary.lrExamId = lrExam?.id ?? null;

    // ------------------------------------------------- shared prerequisites
    const category = await prisma.speakingCategory.findFirst({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (!category)
      throw new Error(
        'No active SpeakingCategory taxonomy — run the seed first.',
      );

    /** Builds (or reuses) an Exam + Assessment + Speaking/Writing sources. */
    async function ensureAssessmentExam(spec: {
      title: string;
      familyCode: string;
      variantCode: string;
      templateKey: string;
      family: ToeicAssessmentProductFamily;
      includeLr: boolean;
    }) {
      const existingExam = await prisma.exam.findFirst({
        where: {
          familyCode: spec.familyCode,
          variantCode: spec.variantCode,
          title: spec.title,
        },
        include: {
          toeicAssessment: { include: { components: true } },
        },
      });
      if (existingExam?.toeicAssessment) return existingExam;
      if (checkOnly) return null;

      return prisma.$transaction(async (tx) => {
        const exam =
          existingExam ??
          (await tx.exam.create({
            data: {
              title: spec.title,
              familyCode: spec.familyCode,
              variantCode: spec.variantCode,
              templateKey: spec.templateKey,
              publicationStatus: QuizPublicationStatus.DRAFT,
            },
          }));

        // Speaking source: deterministic id convention used by the admin
        // service (`exam-<examId>-speaking`), scope EXAM_INTERNAL so it can
        // never be mistaken for standalone skill practice.
        const speakingId = `exam-${exam.id}-speaking`;
        const speaking = await tx.speakingPracticeSet.upsert({
          where: { id: speakingId },
          update: {},
          create: {
            id: speakingId,
            title: `${spec.title} — Speaking`,
            description: 'Nguồn Speaking nội bộ của đề thi (BreadTrans).',
            category: category!.code,
            categoryId: category!.id,
            level: 'B1-C1',
            scope: SpeakingPracticeScope.EXAM_INTERNAL,
            publicationStatus: QuizPublicationStatus.DRAFT,
          },
        });

        // One shared INFORMATION stimulus for Speaking tasks 8-10. The model
        // has no practiceSetId, so identity is the stimulus title.
        const stimulusTitle = `${spec.title} — Lịch hội thảo`;
        let stimulus = await tx.speakingStimulus.findFirst({
          where: {
            kind: SpeakingStimulusKind.INFORMATION,
            title: stimulusTitle,
          },
        });
        stimulus ??= await tx.speakingStimulus.create({
          data: {
            kind: SpeakingStimulusKind.INFORMATION,
            title: stimulusTitle,
            content:
              'BreadTrans Training Day\n09:00 Opening session — Room A1 (Ms. Lan)\n10:30 Listening workshop — Room A2 (Mr. Khoa)\n13:00 Speaking clinic — Room B1 (Ms. Trang)\n15:00 Writing review — Room B2 (Mr. Khoa)',
          },
        });

        // 11 Speaking tasks in canonical order.
        const existingExercises = await tx.speakingExercise.findMany({
          where: { practiceSetId: speaking.id },
          orderBy: { order: 'asc' },
        });
        if (existingExercises.length !== TOEIC_SPEAKING_TASK_SEQUENCE.length) {
          await tx.speakingExercise.deleteMany({
            where: { practiceSetId: speaking.id },
          });
          for (const [
            index,
            taskType,
          ] of TOEIC_SPEAKING_TASK_SEQUENCE.entries()) {
            const content = SPEAKING_TASKS[index];
            await tx.speakingExercise.create({
              data: {
                title: content.title,
                targetText: content.targetText,
                imageUrl: content.imageKey ? publicUrl(content.imageKey) : null,
                taskType,
                order: index + 1,
                practiceSetId: speaking.id,
                categoryId: category!.id,
                category: category!.code,
                difficulty: 'INTERMEDIATE',
                stimulusId: content.usesInformation ? stimulus.id : null,
                publicationStatus: QuizPublicationStatus.DRAFT,
              },
            });
          }
        }

        // Writing source: 8 slots, each backed by a Quiz + Question pair
        // exactly as the admin Writing authoring path produces.
        let writing = await tx.toeicWritingSet.findFirst({
          where: { title: `${spec.title} — Writing` },
          include: { items: true },
        });
        if (!writing) {
          writing = await tx.toeicWritingSet.create({
            data: {
              title: `${spec.title} — Writing`,
              description: 'Nguồn Writing nội bộ của đề thi (BreadTrans).',
              publicationStatus: QuizPublicationStatus.DRAFT,
            },
            include: { items: true },
          });
        }
        if (writing.items.length !== TOEIC_WRITING_SLOT_CONTRACT.length) {
          const oldItems = await tx.toeicWritingSetItem.findMany({
            where: { writingSetId: writing.id },
            select: { writingQuizId: true },
          });
          await tx.toeicWritingSetItem.deleteMany({
            where: { writingSetId: writing.id },
          });
          if (oldItems.length)
            await tx.quiz.deleteMany({
              where: { id: { in: oldItems.map((item) => item.writingQuizId) } },
            });
          for (const [
            index,
            taskKind,
          ] of TOEIC_WRITING_SLOT_CONTRACT.entries()) {
            const content = WRITING_TASKS[index];
            const quiz = await tx.quiz.create({
              data: {
                title: content.title,
                description:
                  'Đề luyện tập do BreadTrans biên soạn; không phải đề thi chính thức của ETS.',
                type:
                  taskKind === 'PICTURE_SENTENCE'
                    ? 'WRITING_PICTURE'
                    : 'WRITING_EMAIL',
                publicationStatus: QuizPublicationStatus.DRAFT,
                questions: {
                  create: {
                    type: 'WRITING',
                    order: 0,
                    content: {
                      prompt: content.prompt,
                      taskType: taskKind,
                      imageUrl: content.imageKey
                        ? publicUrl(content.imageKey)
                        : undefined,
                      keywords: content.keywords,
                      email: content.email,
                    },
                  },
                },
              },
            });
            await tx.toeicWritingSetItem.create({
              data: {
                writingSetId: writing.id,
                writingQuizId: quiz.id,
                order: index + 1,
                taskKind,
              },
            });
          }
        }

        // Assessment + components (LR only for 4 Skills).
        const assessment = await tx.toeicAssessment.upsert({
          where: { examId: exam.id },
          update: {},
          create: {
            title: spec.title,
            productFamily: spec.family,
            examId: exam.id,
            publicationStatus: QuizPublicationStatus.DRAFT,
          },
        });
        const componentCount = await tx.toeicAssessmentComponent.count({
          where: { assessmentId: assessment.id },
        });
        if (componentCount === 0) {
          let order = 1;
          if (spec.includeLr)
            await tx.toeicAssessmentComponent.create({
              data: {
                assessmentId: assessment.id,
                kind: ToeicAssessmentComponentKind.LISTENING_READING,
                order: order++,
                required: true,
                lrExamSetId: CANONICAL.lr.seededExamSetId,
              },
            });
          await tx.toeicAssessmentComponent.create({
            data: {
              assessmentId: assessment.id,
              kind: ToeicAssessmentComponentKind.SPEAKING,
              order: order++,
              required: true,
              speakingPracticeSetId: speaking.id,
            },
          });
          await tx.toeicAssessmentComponent.create({
            data: {
              assessmentId: assessment.id,
              kind: ToeicAssessmentComponentKind.WRITING,
              order: order++,
              required: true,
              writingSetId: writing.id,
            },
          });
        }

        return tx.exam.findUnique({
          where: { id: exam.id },
          include: { toeicAssessment: { include: { components: true } } },
        });
      });
    }

    const swExam = await ensureAssessmentExam({
      ...CANONICAL.sw,
      family: ToeicAssessmentProductFamily.TOEIC_SW,
      includeLr: false,
    });
    summary.swExamId = swExam?.id ?? null;
    summary.swComponents = swExam?.toeicAssessment?.components.length ?? 0;

    const fourExam = await ensureAssessmentExam({
      ...CANONICAL.fourSkills,
      family: ToeicAssessmentProductFamily.TOEIC_4_SKILLS,
      includeLr: true,
    });
    summary.fourSkillsExamId = fourExam?.id ?? null;
    summary.fourSkillsComponents =
      fourExam?.toeicAssessment?.components.length ?? 0;

    console.log(
      checkOnly
        ? 'CANONICAL RECONSTRUCTION (check only)'
        : 'CANONICAL RECONSTRUCTION',
    );
    console.log(JSON.stringify(summary, null, 1));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(
    'Canonical reconstruction failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
