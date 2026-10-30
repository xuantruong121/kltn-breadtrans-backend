/**
 * Materialize TOEIC Listening audio using the CURRENT Phase 0 composition
 * contract. This is the only supported Listening materialization path.
 *
 * Why this replaces the old path
 * ------------------------------
 * `scripts/materialize-toeic-listening-media.ts` composed audio before Phase 0:
 *   Part 1/2 -> options joined by spaces, with no A/B/C/D spoken labels
 *   Part 3/4 -> conversation/talk only, with no spoken question prompts
 * Those surviving R2 objects are therefore semantically obsolete.
 *
 * This script reuses the canonical production functions — no second
 * composition algorithm exists:
 *   buildToeicListeningAudioScript  (Part-aware spoken script)
 *   toeicListeningAudioFingerprint  (semantic provenance hash)
 *   AiService.generateToeicListeningAudio -> buildToeicListeningSsml
 *       (Azure SSML, with <say-as interpret-as="characters"> letter names)
 *
 * Object keys are derived from the stable seeded group ids, and a new
 * `-phase0` suffix is used so the pre-Phase-0 objects are preserved as
 * recovery artifacts rather than overwritten.
 *
 * Idempotent: a group whose stored sourceHash already matches the freshly
 * composed script is skipped without calling the TTS provider.
 *
 * Usage:
 *   npx ts-node scripts/materialize-exam1-listening-phase0.ts            # exam set 1
 *   npx ts-node scripts/materialize-exam1-listening-phase0.ts --exam=1
 *   npx ts-node scripts/materialize-exam1-listening-phase0.ts --dry-run
 *   npx ts-node scripts/materialize-exam1-listening-phase0.ts --key-suffix=v2
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { AiService } from '../src/modules/ai/ai.service';
import { R2Service } from '../src/modules/upload/r2.service';
import {
  buildToeicListeningAudioScript,
  toeicListeningAudioFingerprint,
  TOEIC_LISTENING_AUDIO_SCRIPT_VERSION,
} from '../src/modules/toeic/toeic-listening-audio';

const examArg = process.argv.find((value) => value.startsWith('--exam='));
const examSetId = examArg ? Number(examArg.split('=')[1]) : 1;
const dryRun = process.argv.includes('--dry-run');
const reuseExisting = process.argv.includes('--reuse-existing');
// A new suffix (e.g. --key-suffix=v2 after a content rewrite) writes new
// objects instead of overwriting long-cached ones; the default is unchanged.
const suffixArg = process.argv.find((value) =>
  value.startsWith('--key-suffix='),
);
const keySuffix = suffixArg ? suffixArg.split('=')[1] : 'phase0';
if (!/^[a-z0-9-]+$/.test(keySuffix))
  throw new Error('--key-suffix must be lowercase letters, digits or dashes');

type Report = {
  groupId: number;
  part: number;
  status:
    'REGENERATED' | 'SKIPPED_FRESH' | 'REUSED_EXISTING' | 'BLOCKED' | 'DRY_RUN';
  reason?: string;
  bytes?: number;
  objectKey?: string;
  sourceHash?: string;
};

async function main() {
  const prisma = new PrismaClient();
  const r2 = new R2Service();
  // generateToeicListeningAudio only uses env + the module-level SSML builder;
  // the evaluator strategy is never touched by this code path.
  const ai = new AiService({} as never);

  const report: Report[] = [];
  try {
    const groups = await prisma.toeicQuestionGroup.findMany({
      where: { examId: examSetId, part: { lte: 4 } },
      include: { questions: { orderBy: { questionNumber: 'asc' } } },
      orderBy: [{ part: 'asc' }, { groupOrder: 'asc' }],
    });
    console.log(
      `TOEIC Listening materialization (Phase 0 contract) examSet=${examSetId} groups=${groups.length}${dryRun ? ' [DRY RUN]' : ''}`,
    );
    // Recovery mode must never fall through to Azure. Check all deterministic
    // Phase-0 keys concurrently so a fresh database can relink already
    // verified R2 media without spending a TTS request per group.
    const reusableObjects = reuseExisting
      ? new Map(
          await Promise.all(
            groups.map(
              async (group) =>
                [
                  group.id,
                  await r2.objectExists(
                    `toeic/exams/${examSetId}/groups/${group.id}-${keySuffix}.mp3`,
                  ),
                ] as const,
            ),
          ),
        )
      : new Map<number, boolean>();

    for (const group of groups) {
      let script: string;
      let sourceHash: string;
      try {
        script = buildToeicListeningAudioScript(group);
        sourceHash = toeicListeningAudioFingerprint(group);
      } catch (error) {
        report.push({
          groupId: group.id,
          part: group.part,
          status: 'BLOCKED',
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const metadata = (group.mediaMetadata ?? {}) as {
        audio?: { sourceHash?: string };
      };
      const key = `toeic/exams/${examSetId}/groups/${group.id}-${keySuffix}.mp3`;
      if (group.audioUrl && metadata.audio?.sourceHash === sourceHash) {
        report.push({
          groupId: group.id,
          part: group.part,
          // In --reuse-existing recovery mode, a persisted canonical mapping
          // is affirmative reuse evidence, not a generic freshness skip. This
          // keeps repeated reconstruction reports auditable as 54/54 reuse.
          status: reuseExisting ? 'REUSED_EXISTING' : 'SKIPPED_FRESH',
          objectKey: reuseExisting ? key : undefined,
          sourceHash,
        });
        continue;
      }

      // Stable key from the stable seeded group id; `-phase0` keeps the
      // pre-Phase-0 object at the old key intact.
      if (reuseExisting) {
        if (!reusableObjects.get(group.id)) {
          report.push({
            groupId: group.id,
            part: group.part,
            status: 'BLOCKED',
            reason: 'deterministic Phase-0 object is missing from R2',
            objectKey: key,
            sourceHash,
          });
          continue;
        }
        if (!dryRun) {
          await prisma.toeicQuestionGroup.update({
            where: { id: group.id },
            data: {
              audioUrl: r2.getPublicAssetUrl(key),
              mediaMetadata: {
                ...(group.mediaMetadata as object | null),
                audio: {
                  ...metadata.audio,
                  r2Key: key,
                  sourceHash,
                  scriptVersion: TOEIC_LISTENING_AUDIO_SCRIPT_VERSION,
                  status: 'READY',
                },
              },
            },
          });
        }
        report.push({
          groupId: group.id,
          part: group.part,
          status: dryRun ? 'DRY_RUN' : 'REUSED_EXISTING',
          objectKey: key,
          sourceHash,
        });
        continue;
      }
      if (dryRun) {
        report.push({
          groupId: group.id,
          part: group.part,
          status: 'DRY_RUN',
          objectKey: key,
          sourceHash,
        });
        continue;
      }

      try {
        const audio = await ai.generateToeicListeningAudio(script);
        if (!audio.length) throw new Error('provider returned empty audio');
        await r2.putObjectAtKey(key, audio, 'audio/mpeg');
        if (!(await r2.objectExists(key)))
          throw new Error('R2 did not confirm the uploaded object');
        const url = r2.getPublicAssetUrl(key);

        await prisma.toeicQuestionGroup.update({
          where: { id: group.id },
          data: {
            audioUrl: url,
            mediaMetadata: {
              ...(group.mediaMetadata as object | null),
              audio: {
                source: 'AI_GENERATED',
                status: 'READY',
                r2Key: key,
                generatedAt: new Date().toISOString(),
                sourceHash,
                scriptVersion: TOEIC_LISTENING_AUDIO_SCRIPT_VERSION,
                provider: 'azure-speech',
              },
            },
          },
        });
        report.push({
          groupId: group.id,
          part: group.part,
          status: 'REGENERATED',
          bytes: audio.length,
          objectKey: key,
          sourceHash,
        });
        console.log(
          `  part ${group.part} group ${group.id}: ${audio.length} bytes -> ${key}`,
        );
      } catch (error) {
        report.push({
          groupId: group.id,
          part: group.part,
          status: 'BLOCKED',
          reason: error instanceof Error ? error.message : String(error),
        });
        console.log(
          `  part ${group.part} group ${group.id}: FAILED ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const summary = report.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log('\nSUMMARY', JSON.stringify(summary));
  const blocked = report.filter((item) => item.status === 'BLOCKED');
  if (blocked.length) {
    console.log('BLOCKED groups:');
    for (const item of blocked)
      console.log(
        `  group ${item.groupId} (part ${item.part}): ${item.reason}`,
      );
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(
    'Materialization failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
