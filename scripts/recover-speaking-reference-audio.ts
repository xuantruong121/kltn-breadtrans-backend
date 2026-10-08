import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { R2Service } from '../src/modules/upload/r2.service';
import { parseBuffer } from 'music-metadata';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Mode = 'dry-run' | 'apply';

type ManifestRow = {
  exerciseId: number;
  title: string;
  targetText: string;
  isPremiumContent: boolean;
  oldAudioUrl: string | null;
  candidateKey: string;
  storage: 'public' | 'private';
  classification:
    | 'DB_REFERENCE_VALID'
    | 'R2_ASSET_EXISTS_DB_REFERENCE_MISSING'
    | 'ASSET_NOT_FOUND'
    | 'AMBIGUOUS';
  action: 'skip' | 'recover' | 'generate';
  sourceHash: string;
  error?: string;
};

type GenerationRow = ManifestRow & {
  voice: string;
  locale: string;
  format: 'audio/mpeg';
  durationMs?: number;
  bytes?: number;
  publishedReference?: string;
  result: 'generated' | 'failed';
};

const prisma = new PrismaClient();
const r2 = new R2Service();
const artifactDir = resolve(
  process.cwd(),
  '..',
  '..',
  'artifacts',
  'media-pronunciation-recovery',
);
const voice = 'en-US-JennyNeural';
const locale = 'en-US';
const format = 'audio/mpeg' as const;

function parseArgs(): {
  mode: Mode;
  exerciseId?: number;
  missingOnly: boolean;
} {
  const args = process.argv.slice(2);
  const mode: Mode = args.includes('--apply') ? 'apply' : 'dry-run';
  const idIndex = args.indexOf('--exercise-id');
  const exerciseId = idIndex >= 0 ? Number(args[idIndex + 1]) : undefined;
  if (
    exerciseId !== undefined &&
    (!Number.isInteger(exerciseId) || exerciseId < 1)
  ) {
    throw new Error('--exercise-id must be a positive integer');
  }
  return { mode, exerciseId, missingOnly: args.includes('--missing-only') };
}

function escapeSsml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sourceHash(targetText: string): string {
  return createHash('sha256')
    .update(`${locale}\n${voice}\n${targetText}`)
    .digest('hex');
}

function keyFor(exerciseId: number, isPremiumContent: boolean): string {
  return isPremiumContent
    ? `premium/speaking/exercise-${exerciseId}/reference.mp3`
    : `speaking/exercise-${exerciseId}/reference.mp3`;
}

async function writeArtifact(name: string, value: unknown): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    resolve(artifactDir, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

async function isExistingAsset(
  key: string,
  isPremiumContent: boolean,
): Promise<boolean> {
  return isPremiumContent ? r2.privateObjectExists(key) : r2.objectExists(key);
}

async function synthesize(text: string): Promise<Buffer> {
  const azureKey = process.env.AZURE_SPEECH_KEY?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim();
  if (!azureKey || !region) {
    throw new Error(
      'AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required for --apply',
    );
  }
  const response = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'BreadTrans-speaking-reference-recovery',
      },
      body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${voice}"><prosody rate="1.0">${escapeSsml(text)}</prosody></voice></speak>`,
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Azure TTS ${response.status}: ${body.slice(0, 160)}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const magic = buffer.subarray(0, 3).toString('hex').toLowerCase();
  const startsWithMp3Frame =
    buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  if (
    buffer.length < 256 ||
    (buffer.subarray(0, 3).toString('ascii') !== 'ID3' && !startsWithMp3Frame)
  ) {
    throw new Error(
      `Provider returned an invalid/non-MP3 payload (magic=${magic}, contentType=${response.headers.get('content-type') ?? 'unknown'})`,
    );
  }
  return buffer;
}

async function durationMs(buffer: Buffer): Promise<number> {
  const metadata = await parseBuffer(buffer, {
    mimeType: format,
    size: buffer.length,
  });
  const duration = metadata.format.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Generated audio has no valid duration');
  }
  return Math.round(duration * 1000);
}

async function buildManifest(exerciseId?: number): Promise<ManifestRow[]> {
  const exercises = await prisma.speakingExercise.findMany({
    where: exerciseId ? { id: exerciseId } : undefined,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      targetText: true,
      audioUrl: true,
      isPremiumContent: true,
    },
  });
  const rows: ManifestRow[] = [];
  for (const exercise of exercises) {
    const candidateKey = keyFor(exercise.id, exercise.isPremiumContent);
    const exists = await isExistingAsset(
      candidateKey,
      exercise.isPremiumContent,
    );
    const validDbReference = Boolean(exercise.audioUrl);
    rows.push({
      exerciseId: exercise.id,
      title: exercise.title,
      targetText: exercise.targetText,
      isPremiumContent: exercise.isPremiumContent,
      oldAudioUrl: exercise.audioUrl,
      candidateKey,
      storage: exercise.isPremiumContent ? 'private' : 'public',
      classification: validDbReference
        ? 'DB_REFERENCE_VALID'
        : exists
          ? 'R2_ASSET_EXISTS_DB_REFERENCE_MISSING'
          : 'ASSET_NOT_FOUND',
      action: validDbReference ? 'skip' : exists ? 'recover' : 'generate',
      sourceHash: sourceHash(exercise.targetText),
    });
  }
  return rows;
}

async function main(): Promise<void> {
  const { mode, exerciseId, missingOnly } = parseArgs();
  if (mode === 'apply' && missingOnly === false) {
    // The recovery is intentionally missing-only; no force/overwrite mode exists.
    console.log(
      'Apply mode is always missing-only; valid references are never overwritten.',
    );
  }
  const rows = await buildManifest(exerciseId);
  await writeArtifact('pre-repair-manifest.json', {
    generatedAt: new Date().toISOString(),
    mode,
    missingOnly: true,
    provider: { voice, locale, format },
    rows,
  });
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    JSON.stringify(
      {
        mode,
        total: rows.length,
        counts,
        wouldGenerate: rows.filter((r) => r.action === 'generate').length,
        wouldRecover: rows.filter((r) => r.action === 'recover').length,
        wouldSkip: rows.filter((r) => r.action === 'skip').length,
        artifactDir,
      },
      null,
      2,
    ),
  );
  if (mode === 'dry-run') return;

  if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
    throw new Error(
      'Azure provider configuration is missing; no mutation performed',
    );
  }
  if (!process.env.R2_PUBLIC_URL) {
    throw new Error(
      'R2_PUBLIC_URL is missing; public reference media cannot be published safely',
    );
  }
  if (
    rows.some((row) => row.isPremiumContent) &&
    !r2.isPrivateStorageConfigured()
  ) {
    throw new Error(
      'Private R2 storage is not configured; premium reference media cannot be published safely',
    );
  }

  const generation: GenerationRow[] = [];
  for (const row of rows) {
    if (row.action === 'skip') {
      generation.push({ ...row, voice, locale, format, result: 'generated' });
      continue;
    }
    if (row.action === 'recover') {
      const reference = row.isPremiumContent
        ? row.candidateKey
        : r2.getPublicAssetUrl(row.candidateKey);
      await prisma.speakingExercise.update({
        where: { id: row.exerciseId },
        data: { audioUrl: reference },
      });
      generation.push({
        ...row,
        voice,
        locale,
        format,
        publishedReference: reference,
        result: 'generated',
      });
      continue;
    }
    try {
      const buffer = await synthesize(row.targetText);
      const duration = await durationMs(buffer);
      const upload = row.isPremiumContent
        ? await r2.putPrivateObjectAtKey(row.candidateKey, buffer, format)
        : await r2.putObjectAtKey(row.candidateKey, buffer, format);
      const reference = row.isPremiumContent ? row.candidateKey : upload.url;
      await prisma.speakingExercise.update({
        where: { id: row.exerciseId },
        data: { audioUrl: reference },
      });
      generation.push({
        ...row,
        voice,
        locale,
        format,
        durationMs: duration,
        bytes: buffer.length,
        publishedReference: reference,
        result: 'generated',
      });
      console.log(`published exercise ${row.exerciseId}`);
    } catch (error) {
      generation.push({
        ...row,
        voice,
        locale,
        format,
        result: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`exercise ${row.exerciseId} failed`);
    }
  }
  await writeArtifact('generation-manifest.json', {
    generatedAt: new Date().toISOString(),
    provider: { voice, locale, format },
    rows: generation,
  });
  const post = await prisma.speakingExercise.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, audioUrl: true },
  });
  await writeArtifact('post-repair-manifest.json', {
    generatedAt: new Date().toISOString(),
    total: post.length,
    withAudio: post.filter((row) => row.audioUrl).length,
    rows: post,
  });
  const failed = generation.filter((row) => row.result === 'failed');
  if (failed.length > 0)
    throw new Error(
      `${failed.length} reference audio item(s) failed; see generation-manifest.json`,
    );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
