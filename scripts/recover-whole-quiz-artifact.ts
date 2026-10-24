/**
 * Recover a whole-quiz ("full script") listening artifact through the canonical
 * authoring pipeline, one quiz at a time (spec §7-§18).
 *
 * Why a render and not a relink
 * -----------------------------
 * The rendered tracks survived the incident in object storage, but the
 * destroyed ListeningAudioArtifact row carried the authoritative per-turn
 * `timeline`. Publication makes DICTATION/DIALOGUE questions artifact-backed:
 * the per-question endpoint then serves the whole track and the player seeks
 * using that timeline. Relinking audio without a timeline therefore makes every
 * question play the whole track, and `publish()` itself refuses a timeline-less
 * artifact. Only Azure Speech SDK synthesis emits boundary events, so the
 * timeline can only be restored by re-rendering through the owning service.
 *
 * This script never writes the artifact row itself - the authoring service
 * stays the source of truth. It calls generatePreview, validates the preview,
 * and only then approves and publishes.
 *
 * Surviving historical objects are never overwritten: the service allocates the
 * next version number, and earlier versions stay in storage as evidence.
 *
 * Usage:
 *   npx ts-node scripts/recover-whole-quiz-artifact.ts --quiz 23 --preview
 *   npx ts-node scripts/recover-whole-quiz-artifact.ts --quiz 23 --publish
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { R2Service } from '../src/modules/upload/r2.service';
import { UploadService } from '../src/modules/upload/upload.service';
import { ListeningAudioAuthoringService } from '../src/modules/quiz/listening-audio-authoring.service';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const quizId = Number(arg('quiz'));
const doPublish = process.argv.includes('--publish');
const actorId = Number(arg('actor') ?? 17);

type TimelineTurn = { turnId: string; startMs: number; endMs: number };

function validatePreview(
  artifact: {
    id: number;
    version: number;
    status: string;
    r2Key: string | null;
    r2Url: string | null;
    checksumSha256: string | null;
    durationMs: number | null;
    timeline: unknown;
    accent: string;
    locale: string;
    provider: string;
    voiceRegistryVersion: string;
    outputFormat: string;
  },
  expectedTurnIds: string[],
  expectedTimelineLength: number,
) {
  const problems: string[] = [];
  const timeline = Array.isArray(artifact.timeline)
    ? (artifact.timeline as TimelineTurn[])
    : [];

  if (!timeline.length) problems.push('timeline is empty');
  if (timeline.length !== expectedTimelineLength) {
    problems.push(
      `timeline has ${timeline.length} entries but the canonical script has ${expectedTimelineLength} turns`,
    );
  }
  timeline.forEach((turn, index) => {
    // Only assert identity where the questions actually name their turn.
    if (expectedTurnIds.length && turn.turnId !== expectedTurnIds[index]) {
      problems.push(
        `timeline[${index}] turnId ${turn.turnId} does not match question target turn ${expectedTurnIds[index]}`,
      );
    }
    if (!(turn.endMs > turn.startMs)) {
      problems.push(`timeline[${index}] endMs is not after startMs`);
    }
    if (index > 0 && turn.startMs < timeline[index - 1].endMs) {
      problems.push(
        `timeline[${index}] starts before the previous turn ends (overlap)`,
      );
    }
  });
  const lastEnd = timeline.length ? timeline[timeline.length - 1].endMs : 0;
  if (artifact.durationMs && lastEnd > artifact.durationMs + 250) {
    problems.push(
      `timeline ends at ${lastEnd}ms beyond the audio duration ${artifact.durationMs}ms`,
    );
  }
  if (!artifact.r2Key) problems.push('r2Key missing');
  if (!artifact.checksumSha256) problems.push('checksum missing');
  if (!artifact.durationMs) problems.push('durationMs missing');
  return { problems, timeline, lastEnd };
}

async function main() {
  if (!Number.isInteger(quizId)) {
    throw new Error('--quiz <id> is required');
  }
  const prisma = new PrismaClient() as unknown as PrismaService;
  const authoring = new ListeningAudioAuthoringService(
    prisma,
    new UploadService(new R2Service()),
  );
  const client = prisma as unknown as PrismaClient;

  try {
    const quiz = await client.quiz.findUnique({
      where: { id: quizId },
      select: { id: true, title: true, type: true, isPremiumContent: true },
    });
    if (!quiz) throw new Error(`quiz ${quizId} not found`);
    console.log(
      `quiz ${quiz.id}: ${quiz.title} (${quiz.type}${quiz.isPremiumContent ? ', premium' : ''})`,
    );

    // validateContent proves the canonical contract: at least two speakers and
    // a distinct provider voice per speaker. It reports the turn count; the
    // turn identities come from the questions themselves, which is also what
    // the learner UI aligns against.
    const canonical = await authoring.validateContent(quizId);
    const questions = await client.question.findMany({
      where: { quizId },
      select: { id: true, order: true, content: true },
      orderBy: { order: 'asc' },
    });
    const expectedTurnIds: string[] = questions
      .map((question) => {
        const content = (question.content ?? {}) as Record<string, unknown>;
        return typeof content.targetTurnId === 'string'
          ? content.targetTurnId
          : null;
      })
      .filter((turnId): turnId is string => Boolean(turnId));
    console.log(
      `canonical turns: ${canonical.turns} | speakers: ${canonical.speakers.join(', ')}`,
    );
    console.log(
      `question target turns: ${expectedTurnIds.length}${expectedTurnIds.length ? ` (${expectedTurnIds[0]} .. ${expectedTurnIds[expectedTurnIds.length - 1]})` : ''}`,
    );
    if (expectedTurnIds.length && expectedTurnIds.length !== canonical.turns) {
      console.log(
        `  note: ${canonical.turns} canonical turns vs ${expectedTurnIds.length} question target turns`,
      );
    }
    // Dialogue quizzes group several turns under one question, so fall back to
    // the canonical count when questions do not name a target turn.
    const expectedTimelineLength = expectedTurnIds.length || canonical.turns;

    const before = await client.listeningAudioArtifact.aggregate({
      where: { quizId },
      _max: { version: true },
    });
    console.log(`existing max version: ${before._max.version ?? 0}`);

    // One synthesis call. No retry loop: a retry here would be a second
    // chargeable render.
    console.log('\ncalling generatePreview (single Azure render)...');
    const preview = await authoring.generatePreview(quizId, actorId);
    console.log(
      `preview artifact id=${preview.id} v${preview.version} status=${preview.status} reused=${'reused' in preview ? preview.reused : false}`,
    );

    const artifact = await client.listeningAudioArtifact.findUniqueOrThrow({
      where: { id: preview.id },
    });
    const { problems, timeline, lastEnd } = validatePreview(
      artifact,
      expectedTurnIds,
      expectedTimelineLength,
    );

    console.log(`\nr2Key        : ${artifact.r2Key}`);
    console.log(`r2Url        : ${artifact.r2Url ?? '(none - private)'}`);
    console.log(`checksum     : ${artifact.checksumSha256}`);
    console.log(`durationMs   : ${artifact.durationMs}`);
    console.log(`provider     : ${artifact.provider}`);
    console.log(`voiceRegistry: ${artifact.voiceRegistryVersion}`);
    console.log(`locale/accent: ${artifact.locale} / ${artifact.accent}`);
    console.log(
      `timeline     : ${timeline.length} entries, ends ${lastEnd}ms (audio ${artifact.durationMs}ms)`,
    );
    for (const turn of timeline.slice(0, 4)) {
      console.log(
        `   ${turn.turnId}: ${turn.startMs}ms -> ${turn.endMs}ms (${turn.endMs - turn.startMs}ms)`,
      );
    }
    if (timeline.length > 4) console.log(`   ... ${timeline.length - 4} more`);

    console.log(`\nPREVIEW_VALID=${problems.length === 0}`);
    for (const problem of problems) console.log(`  ! ${problem}`);
    if (problems.length) {
      process.exitCode = 1;
      return;
    }

    if (!doPublish) {
      console.log('\npreview only; re-run with --publish to approve + publish');
      return;
    }

    await authoring.approve(quizId, preview.id, actorId);
    const published = await authoring.publish(quizId, preview.id, actorId);
    console.log(
      `\napproved + published: id=${published.id} v${published.version} status=${published.status}`,
    );
    const final = await client.listeningAudioArtifact.findUniqueOrThrow({
      where: { id: preview.id },
    });
    console.log(
      `PUBLISH_VALID=${final.status === 'PUBLISHED' && Array.isArray(final.timeline) && (final.timeline as unknown[]).length === expectedTurnIds.length}`,
    );
    console.log(`publishedAt: ${final.publishedAt?.toISOString()}`);
  } finally {
    await client.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Whole-quiz artifact recovery failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
