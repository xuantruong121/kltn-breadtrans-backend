/** Read-only access-tier audit. It never changes plans, subscriptions or content. */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient, QuizPublicationStatus, QuizType } from '@prisma/client';

const prisma = new PrismaClient();

const featureForQuizType: Partial<Record<QuizType, string>> = {
  [QuizType.BILINGUAL_READING]: 'PREMIUM_READING',
  [QuizType.LISTENING_PRACTICE]: 'PREMIUM_LISTENING',
  [QuizType.WRITING_PICTURE]: 'PREMIUM_WRITING_CONTENT',
  [QuizType.WRITING_EMAIL]: 'PREMIUM_WRITING_CONTENT',
};

async function main() {
  const [plans, courses, quizzes, speaking, vocab, assessments] = await Promise.all([
    prisma.plan.findMany({
      include: {
        versions: {
          include: { entitlements: true },
          orderBy: { version: 'asc' },
        },
      },
      orderBy: { code: 'asc' },
    }),
    prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, title: true, level: true },
    }),
    prisma.quiz.findMany({
      where: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      select: { id: true, title: true, type: true, isPremiumContent: true },
    }),
    prisma.speakingExercise.findMany({
      where: { publicationStatus: QuizPublicationStatus.PUBLISHED, practiceSetId: null },
      select: { id: true, title: true, isPremiumContent: true, taskType: true },
    }),
    prisma.vocabTopic.findMany({
      where: { publicationStatus: QuizPublicationStatus.PUBLISHED, categoryName: { not: 'SYSTEM_DICTIONARY' } },
      select: { id: true, title: true, isPro: true },
    }),
    prisma.toeicAssessment.findMany({
      where: { publicationStatus: QuizPublicationStatus.PUBLISHED },
      select: { id: true, title: true, productFamily: true },
    }),
  ]);

  const publishedPlanVersions = plans.flatMap((plan) =>
    plan.versions
      .filter((version) => version.status === 'PUBLISHED' && version.isCurrent)
      .map((version) => ({
        planCode: plan.code,
        planDisplayName: plan.displayName,
        version: version.version,
        durationDays: version.durationDays,
        priceVnd: version.priceVnd,
        entitlements: version.entitlements
          .filter((item) => item.enabled)
          .map((item) => item.featureKey),
      })),
  );

  const content = [
    ...courses.map((item) => ({ domain: 'COURSE', canonicalId: item.id, title: item.title, requiredEntitlement: 'COURSE_LIBRARY_ACCESS', free: false, plus: null as boolean | null, pro: null as boolean | null, evidence: 'CourseService.resolveCourseAccess' })),
    ...quizzes.map((item) => ({ domain: `QUIZ_${item.type}`, canonicalId: item.id, title: item.title, requiredEntitlement: item.isPremiumContent ? featureForQuizType[item.type] ?? 'UNMAPPED_PREMIUM_QUIZ' : null, free: !item.isPremiumContent, plus: null as boolean | null, pro: null as boolean | null, evidence: 'QuizContentAccessService' })),
    ...speaking.map((item) => ({ domain: 'SPEAKING', canonicalId: item.id, title: item.title, requiredEntitlement: item.isPremiumContent ? 'PREMIUM_SPEAKING_CONTENT' : null, free: !item.isPremiumContent, plus: null as boolean | null, pro: null as boolean | null, evidence: 'SpeakingContentAccessService' })),
    ...vocab.map((item) => ({ domain: 'VOCAB', canonicalId: item.id, title: item.title, requiredEntitlement: item.isPro ? 'PREMIUM_VOCAB' : null, free: !item.isPro, plus: null as boolean | null, pro: null as boolean | null, evidence: 'VocabService.assertTopicAccess' })),
    ...assessments.map((item) => ({ domain: `TOEIC_${item.productFamily}`, canonicalId: item.id, title: item.title, requiredEntitlement: 'COMPONENT_GOVERNED', free: null as boolean | null, plus: null as boolean | null, pro: null as boolean | null, evidence: 'ToeicAssessmentService.assertLearnerEntitlements' })),
  ];

  const entitlementMap = new Map(publishedPlanVersions.map((version) => [version.planCode, new Set(version.entitlements)]));
  for (const row of content) {
    if (row.requiredEntitlement && row.requiredEntitlement !== 'COMPONENT_GOVERNED') {
      row.plus = entitlementMap.get('PLUS')?.has(row.requiredEntitlement as never) ?? false;
      row.pro = entitlementMap.get('PRO')?.has(row.requiredEntitlement as never) ?? false;
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY',
    publishedPlanVersions,
    allPlanVersions: plans.map((plan) => ({
      code: plan.code,
      status: plan.status,
      versions: plan.versions.map((version) => ({
        id: version.id,
        version: version.version,
        status: version.status,
        isCurrent: version.isCurrent,
        durationDays: version.durationDays,
        priceVnd: version.priceVnd,
        entitlements: version.entitlements
          .filter((item) => item.enabled)
          .map((item) => item.featureKey),
      })),
    })),
    content,
    summary: {
      freeRows: content.filter((row) => row.free === true).length,
      premiumRows: content.filter((row) => Boolean(row.requiredEntitlement) && row.requiredEntitlement !== 'COMPONENT_GOVERNED').length,
      unmappedPremiumRows: content.filter((row) => row.requiredEntitlement === 'UNMAPPED_PREMIUM_QUIZ').length,
      currentFree: entitlementMap.has('FREE'),
      currentPlus: entitlementMap.has('PLUS'),
      currentPro: entitlementMap.has('PRO'),
    },
  };
  const path = join(__dirname, '..', 'artifacts', 'content-access-recovery-manifest.json');
  writeFileSync(path, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ planVersions: publishedPlanVersions, summary: output.summary }, null, 2));
}

main().finally(() => prisma.$disconnect());
