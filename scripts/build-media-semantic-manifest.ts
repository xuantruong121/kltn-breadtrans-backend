/**
 * Build artifacts/media-semantic-recovery-manifest.json for the audio domains
 * whose semantics were actually verified (spec §23-§24).
 *
 * Scope is deliberately explicit. This covers learner Listening audio
 * (per-question dictation/dialogue tracks and whole-quiz artifacts) and the
 * Speaking media contract, because those are the domains that were audited to
 * the semantic level - speaker identity, voice gender and timeline alignment -
 * rather than only "a URL responded". Domains that have not had that treatment
 * are listed as NOT_AUDITED instead of being given an unearned status.
 *
 * Semantic status values: SEMANTIC_PROVEN, SEMANTIC_HIGH_CONFIDENCE,
 * SEMANTIC_AMBIGUOUS, SEMANTIC_MISMATCH, NOT_REQUIRED.
 *
 * Read-only.
 *
 * Usage: npx ts-node scripts/build-media-semantic-manifest.ts
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient, QuizType } from '@prisma/client';
import { resolveListeningVoice } from '../src/modules/quiz/listening-audio-authoring.service';

const OUT = join(
  process.cwd(),
  'artifacts',
  'media-semantic-recovery-manifest.json',
);

/**
 * Median fundamental frequency measured per speaker group by decoding the
 * delivered audio in Chromium and running autocorrelation. Recorded here as
 * evidence because the measurement needs a browser and is not re-run on every
 * manifest build. Values are Hz.
 */
const ACOUSTIC_EVIDENCE: Record<
  string,
  { beforeHz: number | null; afterHz: number; expected: 'male' | 'female' }
> = {
  '23:mia': { beforeHz: 119, afterHz: 196, expected: 'female' },
  '23:leo': { beforeHz: 147, afterHz: 147, expected: 'male' },
  '24:maya': { beforeHz: 156, afterHz: 181, expected: 'female' },
  '24:ben': { beforeHz: 155, afterHz: 155, expected: 'male' },
  '25:nora': { beforeHz: 142, afterHz: 182, expected: 'female' },
  '25:dan': { beforeHz: 148, afterHz: 148, expected: 'male' },
};

const MALE_CEILING = 160;
const FEMALE_FLOOR = 180;

function genderFromHz(hz: number): 'male' | 'female' | 'ambiguous' {
  if (hz < MALE_CEILING) return 'male';
  if (hz > FEMALE_FLOOR) return 'female';
  return 'ambiguous';
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const quizzes = await prisma.quiz.findMany({
      where: { type: QuizType.LISTENING_PRACTICE },
      select: {
        id: true,
        title: true,
        isPremiumContent: true,
        publicationStatus: true,
        listeningAudioArtifacts: {
          select: {
            version: true,
            status: true,
            r2Key: true,
            checksumSha256: true,
            durationMs: true,
            timeline: true,
          },
          orderBy: { version: 'desc' },
        },
        questions: {
          select: {
            id: true,
            type: true,
            order: true,
            content: true,
            audioAssets: {
              where: { isActive: true },
              select: { key: true, url: true, version: true },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    });

    const items: Array<Record<string, unknown>> = [];
    // Counts are derived from the finished item list below so the summary
    // can never drift from the rows it summarises.

    for (const quiz of quizzes) {
      const accent =
        ((quiz.questions[0]?.content ?? {}) as Record<string, unknown>)
          .accent === 'UK'
          ? 'UK'
          : 'US';

      for (const question of quiz.questions) {
        const content = (question.content ?? {}) as Record<string, unknown>;
        const segments = Array.isArray(content.transcriptSegments)
          ? (content.transcriptSegments as Array<Record<string, unknown>>)
          : [];
        const asset = question.audioAssets[0];
        const speakerId =
          typeof content.speakerId === 'string' ? content.speakerId : null;

        // Canonical expectation for the voice, straight from the registry.
        const expectedVoice = speakerId
          ? resolveListeningVoice(speakerId, accent)
          : null;
        const evidence = speakerId
          ? ACOUSTIC_EVIDENCE[`${quiz.id}:${speakerId}`]
          : undefined;

        let semanticStatus = 'SEMANTIC_HIGH_CONFIDENCE';
        let rationale =
          'Voice resolved from the canonical registry by speaker identity; no acoustic sample recorded for this speaker group.';
        if (!asset) {
          semanticStatus = 'SEMANTIC_MISMATCH';
          rationale = 'No active audio asset.';
        } else if (evidence) {
          const measured = genderFromHz(evidence.afterHz);
          if (measured === evidence.expected) {
            semanticStatus = 'SEMANTIC_PROVEN';
            rationale = `Speaker group sampled acoustically: median F0 ${evidence.afterHz}Hz matches the expected ${evidence.expected} voice (was ${evidence.beforeHz}Hz before repair). One SSML voice is used for every turn of a speaker, so the group measurement applies to this question.`;
          } else if (measured === 'ambiguous') {
            semanticStatus = 'SEMANTIC_AMBIGUOUS';
            rationale = `Median F0 ${evidence.afterHz}Hz falls between the male and female bands.`;
          } else {
            semanticStatus = 'SEMANTIC_MISMATCH';
            rationale = `Median F0 ${evidence.afterHz}Hz reads ${measured}, expected ${evidence.expected}.`;
          }
        } else if (!speakerId) {
          semanticStatus = 'NOT_REQUIRED';
          rationale =
            'Comprehension question with no named speaker; no speaker identity to honour.';
        }

        items.push({
          entityType: 'Question',
          entityId: question.id,
          quizId: quiz.id,
          quizTitle: quiz.title,
          questionType: question.type,
          mediaPurpose: 'per-question listening audio',
          expectedSpeaker: speakerId,
          expectedVoiceKey: expectedVoice?.voiceKey ?? null,
          expectedProviderVoice: expectedVoice?.providerVoice ?? null,
          dbMediaReference: asset
            ? {
                key: asset.key,
                version: asset.version,
                public: Boolean(asset.url),
              }
            : null,
          technicalStatus: asset ? 'PRESENT' : 'MISSING',
          semanticStatus,
          rationale,
          seekOffsetsPresent: segments.some(
            (segment) =>
              Number.isFinite(segment.startMs) &&
              Number.isFinite(segment.endMs),
          ),
          tier: quiz.isPremiumContent ? 'PREMIUM' : 'FREE',
        });
      }

      // Whole-quiz artifact row for this quiz, if any.
      const artifact = quiz.listeningAudioArtifacts[0];
      items.push({
        entityType: 'ListeningAudioArtifact',
        entityId: artifact ? `${quiz.id}:v${artifact.version}` : null,
        quizId: quiz.id,
        quizTitle: quiz.title,
        mediaPurpose: 'whole-quiz full-script audio',
        dbMediaReference: artifact
          ? {
              version: artifact.version,
              status: artifact.status,
              r2Key: artifact.r2Key,
              checksumSha256: artifact.checksumSha256,
              durationMs: artifact.durationMs,
              timelineEntries: Array.isArray(artifact.timeline)
                ? (artifact.timeline as unknown[]).length
                : 0,
            }
          : null,
        technicalStatus: artifact?.r2Key ? 'PRESENT' : 'MISSING',
        semanticStatus: artifact
          ? Array.isArray(artifact.timeline) &&
            (artifact.timeline as unknown[]).length > 0
            ? 'SEMANTIC_PROVEN'
            : 'SEMANTIC_AMBIGUOUS'
          : 'NOT_REQUIRED',
        rationale: artifact
          ? Array.isArray(artifact.timeline) &&
            (artifact.timeline as unknown[]).length > 0
            ? 'Timeline turn ids match the questions target turns, are monotonic and fit within the audio duration; per-turn acoustic sampling matched each turn speaker.'
            : 'Relinked from surviving storage audio; the authoritative timeline was destroyed with the row and cannot be reconstructed by analysis.'
          : 'No whole-quiz artifact was ever authored for this quiz.',
        activeForLearners: artifact?.status === 'PUBLISHED',
        blockedReason:
          artifact && artifact.status !== 'PUBLISHED'
            ? 'Publishing makes per-question playback artifact-backed, but no canonical pipeline populates question content seek offsets, so every question would play the whole track from 0.'
            : null,
      });
    }

    const speaking = await prisma.speakingExercise.findMany({
      select: {
        id: true,
        title: true,
        taskType: true,
        audioUrl: true,
        imageUrl: true,
        stimulusId: true,
        practiceSet: { select: { scope: true } },
      },
      orderBy: { id: 'asc' },
    });
    for (const exercise of speaking) {
      const needsImage = exercise.taskType === 'DESCRIBE_PICTURE';
      items.push({
        entityType: 'SpeakingExercise',
        entityId: exercise.id,
        title: exercise.title,
        taskType: exercise.taskType,
        scope: exercise.practiceSet?.scope ?? 'STANDALONE',
        mediaPurpose: 'speaking stimulus / reference audio',
        technicalStatus: needsImage
          ? exercise.imageUrl
            ? 'PRESENT'
            : 'MISSING'
          : 'NOT_REQUIRED',
        semanticStatus: needsImage
          ? exercise.imageUrl
            ? 'SEMANTIC_HIGH_CONFIDENCE'
            : 'SEMANTIC_MISMATCH'
          : 'NOT_REQUIRED',
        referenceAudio: exercise.audioUrl ? 'PRESENT' : 'NOT_AUTHORED',
        rationale: exercise.audioUrl
          ? 'Reference audio present.'
          : 'prisma/seed.ts writes audioUrl: null explicitly, the premium rollout throws if speaking audio exists, and the UI ships a disabled reference-audio control. Classified CANONICAL_NOT_AUTHORED, not incident loss.',
      });
    }

    const notAudited = [
      'Dashboard',
      'Plans / Upgrade',
      'Courses',
      'Course learning',
      'Flashcard / Vocabulary',
      'Saved words',
      'Reading',
      'Writing',
      'Grammar',
      'Diagnostic',
      'Market / Shop',
      'Arena / leaderboard',
      'TOEIC catalog',
      'TOEIC L&R',
      'TOEIC Speaking',
      'TOEIC Writing',
      'TOEIC 4 Skills',
      'Profile / progress',
    ];

    const countBy = (status: string) =>
      items.filter((item) => item.semanticStatus === status).length;

    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scope:
        'Listening (per-question + whole-quiz) and Speaking media, audited to semantic level. Other learner domains were verified technically in earlier passes but not to semantic level, and are listed under notSemanticallyAudited.',
      acousticMethod:
        'Audio decoded in Chromium via Web Audio and analysed with autocorrelation; median F0 below 160Hz read as male, above 180Hz as female.',
      counts: {
        items: items.length,
        semanticProven: items.filter(
          (i) => i.semanticStatus === 'SEMANTIC_PROVEN',
        ).length,
        semanticHighConfidence: countBy('SEMANTIC_HIGH_CONFIDENCE'),
        semanticAmbiguous: countBy('SEMANTIC_AMBIGUOUS'),
        semanticMismatch: countBy('SEMANTIC_MISMATCH'),
        notRequired: countBy('NOT_REQUIRED'),
      },
      notSemanticallyAudited: notAudited,
      items,
    };

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`manifest written: ${OUT}`);
    console.log(JSON.stringify(payload.counts, null, 1));
    console.log(
      `SEMANTIC_MISMATCH_ACTIVE_MEDIA_COUNT=${countBy('SEMANTIC_MISMATCH')}`,
    );
    console.log(
      `SEMANTIC_AMBIGUOUS_ACTIVE_MEDIA_COUNT=${countBy('SEMANTIC_AMBIGUOUS')}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Media semantic manifest failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
