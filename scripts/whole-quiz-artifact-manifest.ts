/**
 * Export and restore whole-quiz ("full script") listening artifacts without
 * calling a TTS provider (spec §20-§24).
 *
 * Why this exists
 * ---------------
 * The incident destroyed every ListeningAudioArtifact row. The rendered audio
 * survived in object storage, but the per-turn `timeline` lived only in the
 * database, so the audio alone was not enough to restore the feature - and a
 * timeline can only be produced by Azure Speech SDK synthesis. Leaving the
 * recovered timeline only in the live database would recreate exactly that
 * weakness, so it is exported to a source-controlled manifest here.
 *
 * `--export` writes every artifact that has a valid timeline and an R2 key.
 * `--restore` rebuilds the rows from the manifest: it verifies the stored
 * object still exists and matches the recorded checksum, then restores the
 * artifact with its exact timeline. It never synthesizes audio.
 *
 * Fail-closed and idempotent:
 *   - ambiguous quiz identity                -> refuse
 *   - object missing or checksum mismatch    -> refuse
 *   - an existing row already matching       -> ALREADY_VALID, no write
 *   - an existing row with different content  -> CONFLICT, refuse
 *
 * Usage:
 *   npx ts-node scripts/whole-quiz-artifact-manifest.ts --export
 *   npx ts-node scripts/whole-quiz-artifact-manifest.ts --restore
 *   npx ts-node scripts/whole-quiz-artifact-manifest.ts --restore --activate
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  R2Service,
  isPrivateListeningMediaKey,
} from '../src/modules/upload/r2.service';
import { UploadService } from '../src/modules/upload/upload.service';
import { sha256 } from '../src/modules/quiz/listening-audio-authoring.service';

const MANIFEST = join(
  process.cwd(),
  'artifacts',
  'listening-whole-quiz-artifacts.json',
);

const doExport = process.argv.includes('--export');
const doRestore = process.argv.includes('--restore');
/**
 * Publication is opt-in. Publishing makes DICTATION questions artifact-backed,
 * and the dictation UI seeks using question content offsets that no canonical
 * pipeline currently populates, so a restored artifact stays parked by default.
 */
const activate = process.argv.includes('--activate');

type TimelineTurn = { turnId: string; startMs: number; endMs: number };

type ManifestEntry = {
  quiz: { id: number; title: string; type: string; isPremiumContent: boolean };
  artifact: {
    version: number;
    r2Key: string;
    r2Url: string | null;
    checksumSha256: string;
    bytes: number;
    contentType: string;
    durationMs: number | null;
    provider: string;
    locale: string;
    accent: string;
    voiceRegistryVersion: string;
    outputFormat: string;
    synthesisHash: string;
    contentHash: string;
  };
  timeline: TimelineTurn[];
  provenance: {
    recoveredAt: string;
    method: string;
    note: string;
  };
};

function timelineOf(value: unknown): TimelineTurn[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (turn): turn is TimelineTurn =>
      Boolean(turn) &&
      typeof (turn as TimelineTurn).turnId === 'string' &&
      Number.isFinite((turn as TimelineTurn).startMs) &&
      Number.isFinite((turn as TimelineTurn).endMs),
  );
}

async function readObject(upload: UploadService, key: string) {
  return isPrivateListeningMediaKey(key)
    ? upload.downloadPrivateFileBuffer(key)
    : upload.downloadFileBuffer(key);
}

async function runExport(prisma: PrismaClient, upload: UploadService) {
  const artifacts = await prisma.listeningAudioArtifact.findMany({
    include: {
      quiz: {
        select: {
          id: true,
          title: true,
          type: true,
          isPremiumContent: true,
        },
      },
    },
    orderBy: [{ quizId: 'asc' }, { version: 'desc' }],
  });

  const entries: ManifestEntry[] = [];
  const skipped: string[] = [];
  const seen = new Set<number>();

  for (const artifact of artifacts) {
    if (seen.has(artifact.quizId)) continue; // newest version per quiz
    const timeline = timelineOf(artifact.timeline);
    if (!timeline.length) {
      skipped.push(`quiz ${artifact.quizId} v${artifact.version}: no timeline`);
      continue;
    }
    if (!artifact.r2Key) {
      skipped.push(`quiz ${artifact.quizId} v${artifact.version}: no r2Key`);
      continue;
    }
    let bytes = 0;
    let checksum = artifact.checksumSha256 ?? '';
    try {
      const buffer = await readObject(upload, artifact.r2Key);
      bytes = buffer.length;
      const actual = sha256(buffer);
      if (checksum && checksum !== actual) {
        skipped.push(
          `quiz ${artifact.quizId} v${artifact.version}: stored checksum does not match the object`,
        );
        continue;
      }
      checksum = actual;
    } catch (error) {
      skipped.push(
        `quiz ${artifact.quizId} v${artifact.version}: object unreadable (${error instanceof Error ? error.message : error})`,
      );
      continue;
    }
    seen.add(artifact.quizId);
    entries.push({
      quiz: artifact.quiz,
      artifact: {
        version: artifact.version,
        r2Key: artifact.r2Key,
        r2Url: artifact.r2Url,
        checksumSha256: checksum,
        bytes,
        contentType: 'audio/mpeg',
        durationMs: artifact.durationMs,
        provider: artifact.provider,
        locale: artifact.locale,
        accent: artifact.accent,
        voiceRegistryVersion: artifact.voiceRegistryVersion,
        outputFormat: artifact.outputFormat,
        synthesisHash: artifact.synthesisHash,
        contentHash: artifact.contentHash,
      },
      timeline,
      provenance: {
        recoveredAt: new Date().toISOString(),
        method: 'canonical authoring pipeline (Azure Speech SDK) re-render',
        note: 'The pre-incident audio survived in object storage but the authoritative per-turn timeline did not. This entry preserves the timeline so a future rebuild can relink instead of paying for another render.',
      },
    });
  }

  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(
    MANIFEST,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        entries,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`manifest written: ${MANIFEST}`);
  console.log(`entries: ${entries.length}`);
  for (const entry of entries) {
    console.log(
      `  quiz ${entry.quiz.id} v${entry.artifact.version} ${entry.timeline.length} turns ${entry.artifact.bytes} bytes ${entry.artifact.r2Key}`,
    );
  }
  if (skipped.length) {
    console.log(`skipped: ${skipped.length}`);
    for (const reason of skipped) console.log(`  - ${reason}`);
  }
}

async function runRestore(prisma: PrismaClient, upload: UploadService) {
  if (!existsSync(MANIFEST)) {
    throw new Error(`manifest not found: ${MANIFEST}`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    entries: ManifestEntry[];
  };
  const summary = {
    restored: 0,
    alreadyValid: 0,
    conflict: 0,
    refused: 0,
  };

  for (const entry of manifest.entries) {
    const label = `quiz ${entry.quiz.id} v${entry.artifact.version}`;

    // Canonical identity, never a bare autoincrement id.
    const quizzes = await prisma.quiz.findMany({
      where: { title: entry.quiz.title, type: entry.quiz.type as never },
      select: { id: true },
    });
    if (quizzes.length !== 1 || quizzes[0].id !== entry.quiz.id) {
      summary.refused++;
      console.log(
        `  ${label}: REFUSED ambiguous quiz identity (${quizzes.length} match "${entry.quiz.title}")`,
      );
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await readObject(upload, entry.artifact.r2Key);
    } catch {
      summary.refused++;
      console.log(`  ${label}: REFUSED object missing ${entry.artifact.r2Key}`);
      continue;
    }
    const actual = sha256(buffer);
    if (actual !== entry.artifact.checksumSha256) {
      summary.refused++;
      console.log(
        `  ${label}: REFUSED checksum mismatch (expected ${entry.artifact.checksumSha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`,
      );
      continue;
    }

    const existing = await prisma.listeningAudioArtifact.findUnique({
      where: {
        quizId_synthesisHash: {
          quizId: entry.quiz.id,
          synthesisHash: entry.artifact.synthesisHash,
        },
      },
    });
    if (existing) {
      const sameTimeline =
        JSON.stringify(timelineOf(existing.timeline)) ===
        JSON.stringify(entry.timeline);
      if (existing.r2Key === entry.artifact.r2Key && sameTimeline) {
        summary.alreadyValid++;
        console.log(`  ${label}: ALREADY_VALID (${existing.status})`);
        continue;
      }
      summary.conflict++;
      console.log(
        `  ${label}: CONFLICT existing row differs (r2Key ${existing.r2Key === entry.artifact.r2Key ? 'same' : 'different'}, timeline ${sameTimeline ? 'same' : 'different'}) - refusing to overwrite authored content`,
      );
      continue;
    }

    await prisma.listeningAudioArtifact.create({
      data: {
        quizId: entry.quiz.id,
        version: entry.artifact.version,
        synthesisHash: entry.artifact.synthesisHash,
        contentHash: entry.artifact.contentHash,
        status: activate ? 'PUBLISHED' : 'APPROVED',
        provider: entry.artifact.provider,
        locale: entry.artifact.locale,
        accent: entry.artifact.accent,
        voiceRegistryVersion: entry.artifact.voiceRegistryVersion,
        outputFormat: entry.artifact.outputFormat,
        r2Key: entry.artifact.r2Key,
        r2Url: entry.artifact.r2Url,
        checksumSha256: entry.artifact.checksumSha256,
        durationMs: entry.artifact.durationMs,
        timeline: entry.timeline as never,
        approvedAt: new Date(),
        publishedAt: activate ? new Date() : null,
      },
    });
    summary.restored++;
    console.log(
      `  ${label}: RESTORED ${entry.timeline.length} turns, status ${activate ? 'PUBLISHED' : 'APPROVED'} (no audio synthesized)`,
    );
  }

  console.log(`\n${JSON.stringify(summary)}`);
  console.log(
    `WHOLE_QUIZ_RESTORE_REFUSED=${summary.refused + summary.conflict}`,
  );
  if (summary.refused + summary.conflict > 0) process.exitCode = 1;
}

async function main() {
  if (!doExport && !doRestore) {
    throw new Error('pass --export or --restore');
  }
  const prisma = new PrismaClient();
  const upload = new UploadService(new R2Service());
  try {
    if (doExport) await runExport(prisma, upload);
    if (doRestore) await runRestore(prisma, upload);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Whole-quiz artifact manifest failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
