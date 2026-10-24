import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient, QuizType } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * `rollout-premium-content.ts` was introduced together with the subscription
 * module in commit 03a143c and is the approved production assignment manifest.
 * Text-only Reading/Writing/Speaking entries cannot have an R2-media second
 * signal by design, so this audit records that manifest as authoritative
 * business evidence rather than falsely treating those rows as Free.
 */
const manifest = {
  reading: { premium: [14, 15, 16], free: [2, 6, 13] },
  listening: { premium: [5, 10, 11, 12, 25], free: [1, 9, 23, 24, 26, 27, 28] },
  writing: { premium: [4, 7, 18, 19], free: [3, 17] },
  speaking: {
    premium: [6, 7, 8, 9, 10, ...Array.from({ length: 13 }, (_, index) => index + 18)],
    free: [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 16, 17],
  },
} as const;

async function assertQuizFlags(ids: readonly number[], expected: boolean, type: QuizType) {
  const rows = await prisma.quiz.findMany({
    where: { id: { in: [...ids] }, type },
    select: { id: true, isPremiumContent: true, title: true },
  });
  if (rows.length !== ids.length || rows.some((row) => row.isPremiumContent !== expected)) {
    throw new Error(`Quiz premium assignment mismatch for ${type}`);
  }
  return rows;
}

async function main() {
  const [readingPremium, readingFree, listeningPremium, listeningFree, writingPremium, writingFree, speaking] = await Promise.all([
    assertQuizFlags(manifest.reading.premium, true, QuizType.BILINGUAL_READING),
    assertQuizFlags(manifest.reading.free, false, QuizType.BILINGUAL_READING),
    assertQuizFlags(manifest.listening.premium, true, QuizType.LISTENING_PRACTICE),
    assertQuizFlags(manifest.listening.free, false, QuizType.LISTENING_PRACTICE),
    prisma.quiz.findMany({ where: { id: { in: [...manifest.writing.premium] }, type: { in: [QuizType.WRITING_EMAIL, QuizType.WRITING_PICTURE] } }, select: { id: true, isPremiumContent: true, title: true } }),
    prisma.quiz.findMany({ where: { id: { in: [...manifest.writing.free] }, type: { in: [QuizType.WRITING_EMAIL, QuizType.WRITING_PICTURE] } }, select: { id: true, isPremiumContent: true, title: true } }),
    prisma.speakingExercise.findMany({ where: { id: { in: [...manifest.speaking.premium, ...manifest.speaking.free] } }, select: { id: true, isPremiumContent: true, title: true } }),
  ]);
  if (
    writingPremium.length !== manifest.writing.premium.length ||
    writingPremium.some((row) => !row.isPremiumContent) ||
    writingFree.length !== manifest.writing.free.length ||
    writingFree.some((row) => row.isPremiumContent) ||
    speaking.length !== manifest.speaking.premium.length + manifest.speaking.free.length ||
    speaking.some((row) =>
      manifest.speaking.premium.includes(row.id)
        ? !row.isPremiumContent
        : row.isPremiumContent,
    )
  ) {
    throw new Error('Writing or Speaking premium assignment mismatch');
  }
  const provenPremiumIds = manifest.listening.premium;
  const canonicalManifestPremiumIds = [
    ...manifest.reading.premium,
    ...manifest.writing.premium,
    ...manifest.speaking.premium,
  ];
  const artifact = {
    generatedAt: new Date().toISOString(),
    manifestAuthority: {
      source: 'scripts/rollout-premium-content.ts',
      commit: '03a143c',
      rationale: 'Committed production rollout manifest; text-only domains have no structurally possible R2-media corroboration.',
    },
    counts: {
      provenPremium: provenPremiumIds.length,
      canonicalManifestConfirmedPremium: canonicalManifestPremiumIds.length,
      ambiguousPremiumWithheld: 0,
      totalPremium: provenPremiumIds.length + canonicalManifestPremiumIds.length,
      freeAssignments: readingFree.length + listeningFree.length + writingFree.length + manifest.speaking.free.length,
    },
    assignments: {
      provenPremium: { listeningQuizIds: provenPremiumIds },
      canonicalManifestConfirmed: {
        readingQuizIds: manifest.reading.premium,
        writingQuizIds: manifest.writing.premium,
        speakingExerciseIds: manifest.speaking.premium,
      },
      free: {
        readingQuizIds: manifest.reading.free,
        listeningQuizIds: manifest.listening.free,
        writingQuizIds: manifest.writing.free,
        speakingExerciseIds: manifest.speaking.free,
      },
    },
  };
  writeFileSync(
    join(__dirname, '..', 'artifacts', 'premium-content-recovery-evidence.json'),
    JSON.stringify(artifact, null, 2),
  );
  console.log(JSON.stringify({ PREMIUM_CONTENT_RECOVERY: 'PASS', ...artifact.counts }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
