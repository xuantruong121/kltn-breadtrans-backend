import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { parseBuffer } from 'music-metadata';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { R2Service } from '../src/modules/upload/r2.service';

type Accent = 'us' | 'uk';
type Classification =
  | 'VALID_MANAGED_AUDIO'
  | 'VALID_EXTERNAL_AUDIO'
  | 'BROKEN_REFERENCE'
  | 'R2_ASSET_EXISTS_DB_REFERENCE_MISSING'
  | 'MISSING'
  | 'AMBIGUOUS';

type Row = {
  vocabWordId: number;
  word: string;
  pos: string;
  topicId: number;
  accent: Accent;
  oldDbValue: string | null;
  key: string;
  reference: string;
  classification: Classification;
  action: 'skip' | 'recover' | 'generate' | 'error';
  sourceHash: string;
  bytes?: number;
  durationMs?: number;
  newDbValue?: string | null;
  status?: 'planned' | 'recovered' | 'generated' | 'skipped' | 'failed';
  error?: string;
};

const prisma = new PrismaClient();
const r2 = new R2Service();
const artifactDir = resolve(
  process.cwd(),
  '..',
  '..',
  'artifacts',
  'vocab-accent-audio-catalog',
);
const format = 'audio/mpeg';
const outputFormat = 'audio-16khz-128kbitrate-mono-mp3';
const policy: Record<Accent, { locale: string; voice: string }> = {
  us: { locale: 'en-US', voice: 'en-US-JennyNeural' },
  uk: { locale: 'en-GB', voice: 'en-GB-SoniaNeural' },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const wordIndex = args.indexOf('--word-id');
  const limitIndex = args.indexOf('--limit');
  const accentIndex = args.indexOf('--accent');
  const accentValue = accentIndex >= 0 ? args[accentIndex + 1] : undefined;
  const wordId = wordIndex >= 0 ? Number(args[wordIndex + 1]) : undefined;
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;
  if (wordId !== undefined && (!Number.isInteger(wordId) || wordId < 1)) {
    throw new Error('--word-id must be a positive integer');
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  if (accentValue && !['us', 'uk', 'both'].includes(accentValue)) {
    throw new Error('--accent must be us, uk, or both');
  }
  const accents: Accent[] = accentValue === 'us' || accentValue === 'uk'
    ? [accentValue]
    : ['us', 'uk'];
  return {
    apply: args.includes('--apply'),
    verifyOnly: args.includes('--verify-only'),
    force: args.includes('--force'),
    wordId,
    limit,
    accents,
  };
}

function keyFor(id: number, accent: Accent): string {
  return `vocab/pronunciation/${accent}/word-${id}.mp3`;
}

function sourceHash(id: number, word: string, accent: Accent): string {
  const { locale, voice } = policy[accent];
  return createHash('sha256')
    .update(JSON.stringify({ id, word, accent, locale, voice, outputFormat }))
    .digest('hex');
}

function escapeSsml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function writeArtifact(name: string, value: unknown): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(resolve(artifactDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function headValid(key: string): Promise<{ bytes: number; contentType?: string } | null> {
  const head = await r2.headObject(key);
  if (!head || head.contentLength <= 0) return null;
  if (head.contentType && !head.contentType.toLowerCase().startsWith('audio/')) return null;
  return { bytes: head.contentLength, contentType: head.contentType };
}

async function classify(
  row: { id: number; word: string; audioUs: string | null; audioUk: string | null },
  accent: Accent,
): Promise<Row> {
  const key = keyFor(row.id, accent);
  const reference = r2.getPublicAssetUrl(key);
  const oldDbValue = accent === 'us' ? row.audioUs : row.audioUk;
  let classification: Classification = 'MISSING';
  let action: Row['action'] = 'generate';
  let error: string | undefined;
  try {
    if (oldDbValue) {
      const isManaged = oldDbValue === reference;
      if (isManaged) {
        const head = await headValid(key);
        classification = head ? 'VALID_MANAGED_AUDIO' : 'BROKEN_REFERENCE';
        action = head ? 'skip' : 'generate';
      } else {
        classification = 'VALID_EXTERNAL_AUDIO';
        action = 'skip';
      }
    } else {
      const head = await headValid(key);
      if (head) {
        classification = 'R2_ASSET_EXISTS_DB_REFERENCE_MISSING';
        action = 'recover';
      }
    }
  } catch (cause) {
    classification = 'AMBIGUOUS';
    action = 'error';
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return {
    vocabWordId: row.id,
    word: row.word,
    pos: '',
    topicId: 0,
    accent,
    oldDbValue,
    key,
    reference,
    classification,
    action,
    sourceHash: sourceHash(row.id, row.word, accent),
    error,
  };
}

async function synthesize(text: string, accent: Accent): Promise<Buffer> {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim();
  if (!key || !region) throw new Error('Azure Speech configuration is missing');
  const { locale, voice } = policy[accent];
  const body = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${voice}"><prosody rate="1.0">${escapeSsml(text)}</prosody></voice></speak>`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': outputFormat,
          'User-Agent': 'BreadTrans-vocab-accent-catalog',
        },
        body,
      });
      if (!response.ok) throw new Error(`Azure TTS HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const isMp3 = buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer.length > 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
      if (buffer.length < 256 || !isMp3) throw new Error('Azure returned a non-MP3 payload');
      return buffer;
    } catch (cause) {
      lastError = cause;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function validateAudio(buffer: Buffer): Promise<number> {
  const metadata = await parseBuffer(buffer, { mimeType: format, size: buffer.length });
  const duration = metadata.format.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) throw new Error('Generated audio has no valid duration');
  return Math.round(duration * 1000);
}

async function verifyProvider(): Promise<void> {
  for (const accent of ['us', 'uk'] as Accent[]) {
    const buffer = await synthesize('stock', accent);
    const durationMs = await validateAudio(buffer);
    console.log(JSON.stringify({ probe: accent, voice: policy[accent].voice, locale: policy[accent].locale, bytes: buffer.length, durationMs }));
  }
}

async function mapWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>, concurrency = 20): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const where = args.wordId ? { id: args.wordId } : undefined;
  const words = await prisma.vocabWord.findMany({
    where,
    orderBy: { id: 'asc' },
    select: { id: true, word: true, pos: true, topicId: true, audioUs: true, audioUk: true },
  });
  if (!words.length) throw new Error('No canonical VocabWord matched the selection');
  const selectedWords = args.limit ? words.slice(0, args.limit) : words;
  const work = selectedWords.flatMap((word) => args.accents.map((accent) => ({ word, accent })));
  const rows = await mapWithConcurrency(work, async ({ word, accent }) => {
    const classified = await classify(word, accent);
    classified.pos = word.pos;
    classified.topicId = word.topicId;
    return classified;
  });
  if (args.verifyOnly) {
    const checks = await mapWithConcurrency(rows, async (row) => {
      const head = await headValid(row.key);
      return { ...row, verified: Boolean(head), bytes: head?.bytes };
    });
    const broken = checks.filter((row) => !row.verified);
    const byAccent = (accent: Accent) => checks.filter((row) => row.accent === accent);
    const coverage = {
      generatedAt: new Date().toISOString(),
      totalWords: words.length,
      totalReferences: checks.length,
      audioUs: byAccent('us').filter((row) => row.verified).length,
      audioUk: byAccent('uk').filter((row) => row.verified).length,
      brokenReferences: broken.length,
      broken,
      keyPrefix: 'vocab/pronunciation/{us|uk}/word-{VocabWord.id}.mp3',
    };
    await writeArtifact('coverage.json', coverage);
    await writeArtifact('failed-assets.json', broken);
    console.log(JSON.stringify(coverage, null, 2));
    if (broken.length) throw new Error(`${broken.length} managed R2 reference(s) failed verification`);
    return;
  }
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {});
  const planned = rows.filter((row) => row.action === 'generate').length;
  const recoverable = rows.filter((row) => row.action === 'recover').length;
  const preState = { generatedAt: new Date().toISOString(), totalWords: words.length, selectedWords: selectedWords.length, rows };
  await writeArtifact('pre-state.json', preState);
  await writeArtifact('vocab-audio-before.json', preState);
  await writeArtifact('recovered-assets.json', rows.filter((row) => row.action === 'recover'));
  await writeArtifact('dry-run.json', {
    ...preState,
    mode: args.apply ? 'apply' : 'dry-run',
    counts,
    wouldGenerate: planned,
    wouldRecover: recoverable,
    wouldUpload: planned,
    wouldUpdate: planned + recoverable,
    plannedAzureCalls: args.apply ? planned + args.accents.length : 0,
    provider: policy,
    outputFormat,
  });
  console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', totalCanonicalWords: words.length, selectedWords: selectedWords.length, counts, wouldGenerate: planned, wouldRecover: recoverable, wouldUpload: planned, wouldUpdate: planned + recoverable, plannedAzureCalls: args.apply ? planned + args.accents.length : 0, artifactDir }, null, 2));
  if (!args.apply) return;
  if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION || !process.env.R2_PUBLIC_URL || !process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new Error('Azure and public R2 configuration are required for --apply');
  }
  if (rows.some((row) => row.action === 'error')) throw new Error('R2 inventory is ambiguous; no generation started');
  await verifyProvider();
  const manifest: Row[] = [];
  for (const row of rows) {
    if (row.action === 'skip' && !args.force) {
      row.status = 'skipped';
      row.newDbValue = row.oldDbValue;
      manifest.push(row);
      continue;
    }
    if (row.action === 'recover' && !args.force) {
      const head = await headValid(row.key);
      if (!head) throw new Error(`R2 recovery object disappeared: ${row.key}`);
      await prisma.vocabWord.update({ where: { id: row.vocabWordId }, data: row.accent === 'us' ? { audioUs: row.reference } : { audioUk: row.reference } });
      row.status = 'recovered';
      row.newDbValue = row.reference;
      row.bytes = head.bytes;
      manifest.push(row);
      continue;
    }
    try {
      const buffer = await synthesize(row.word, row.accent);
      row.durationMs = await validateAudio(buffer);
      row.bytes = buffer.length;
      await r2.putObjectAtKey(row.key, buffer, format);
      const head = await headValid(row.key);
      if (!head) throw new Error(`Uploaded object failed verification: ${row.key}`);
      await prisma.vocabWord.update({ where: { id: row.vocabWordId }, data: row.accent === 'us' ? { audioUs: row.reference } : { audioUk: row.reference } });
      row.status = 'generated';
      row.newDbValue = row.reference;
      manifest.push(row);
      console.log(`published ${row.accent} vocabWord ${row.vocabWordId}`);
    } catch (cause) {
      row.status = 'failed';
      row.error = cause instanceof Error ? cause.message : String(cause);
      manifest.push(row);
      console.error(`failed ${row.accent} vocabWord ${row.vocabWordId}: ${row.error}`);
    }
    await writeArtifact('generation-manifest.json', { generatedAt: new Date().toISOString(), provider: policy, outputFormat, rows: manifest });
  }
  await writeArtifact('generation-manifest.json', { generatedAt: new Date().toISOString(), provider: policy, outputFormat, rows: manifest });
  const postRows = await prisma.vocabWord.findMany({ orderBy: { id: 'asc' }, select: { id: true, word: true, audioUs: true, audioUk: true } });
  await writeArtifact('post-state.json', { generatedAt: new Date().toISOString(), total: postRows.length, rows: postRows });
  await writeArtifact('vocab-audio-after.json', { generatedAt: new Date().toISOString(), total: postRows.length, rows: postRows });
  const failed = manifest.filter((row) => row.status === 'failed');
  const coverage = { total: postRows.length, audioUs: postRows.filter((row) => Boolean(row.audioUs)).length, audioUk: postRows.filter((row) => Boolean(row.audioUk)).length, failed: failed.length };
  await writeArtifact('coverage.json', coverage);
  await writeArtifact('failed-assets.json', failed);
  if (failed.length) throw new Error(`${failed.length} asset(s) failed; inspect failed-assets.json`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
