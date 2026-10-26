/**
 * Entry Diagnostic V2 — Listening audio (Phase E).
 *
 * The approved content has 4 listening scripts (LST_CLIP_01..04) shared by 10
 * questions. Each question has a pending `DiagnosticListeningClip` row
 * (`*.pending`, inactive) and `options.audioUrl = null`, so the runtime
 * reports NOT_READY and the assessment cannot run.
 *
 * Modes (one per run):
 *   plan             read-only. Verifies every clip row against the approved
 *                    draft (script text and sha256), prints the casting, SSML,
 *                    target keys and exact rows a publish would change. No
 *                    network, no writes. Safe against any database.
 *   generate         Azure TTS, 4 syntheses, writes MP3s + manifest to --out.
 *                    No upload, no database write. Requires
 *                    DIAG_V2_TTS_AUTHORIZED=generate-4-clips.
 *   publish          uploads the 4 generated MP3s to the PUBLIC R2 bucket and
 *                    activates the 10 clip rows + 10 question audioUrls of
 *                    assessment 5, in one transaction, only if it is still a
 *                    DRAFT with pending clips. Requires
 *                    DIAG_V2_AUDIO_PUBLISH_AUTHORIZED=publish-4-clips and an
 *                    explicit --target URL.
 *   harness-fixture  DISPOSABLE CLONE ONLY. Points the 10 questions at an
 *                    existing public practice MP3 so playback, media status
 *                    and runtime readiness can be tested. Marked
 *                    HARNESS_FIXTURE_NOT_SCRIPT_AUDIO; refuses protected
 *                    clusters.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/diagnostic-v2-listening-audio.ts plan --target <db-url>
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { parseBuffer } from 'music-metadata';

import {
  escapeXml,
  LISTENING_VOICE_REGISTRY,
  LISTENING_VOICE_REGISTRY_VERSION,
} from '../src/modules/quiz/listening-audio-authoring.service';

const PROTECTED_CLUSTERS = ['7674533776495505443', '7699757546958700579'];
const ASSESSMENT_SOURCE_KEY = 'DIAG_V2_ASSESSMENT';
const OUTPUT_FORMAT = 'Audio16Khz128KBitRateMonoMp3';
const KEY_PREFIX = 'diagnostic/v2';

/**
 * PROPOSED casting (Phase E requires it to be decided, not inferred). Voices
 * are the production listening registry (version above), which already
 * produced published en-US practice audio. Change only with the owner's
 * decision; the plan prints exactly what is used.
 */
export const PROPOSED_CASTING: Record<
  string,
  Record<string, keyof typeof LISTENING_VOICE_REGISTRY>
> = {
  LST_CLIP_01: { A: 'en-us-female-01', B: 'en-us-male-01' },
  LST_CLIP_02: { NARRATOR: 'en-us-male-01' },
  LST_CLIP_03: { NARRATOR: 'en-us-female-01' },
  LST_CLIP_04: { A: 'en-us-male-01', B: 'en-us-female-01' },
};

type Turn = { speaker: string; text: string };

export function splitTurns(script: string): Turn[] {
  const lines = script
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const dialogue = lines.every((l) => /^[AB]:\s/.test(l));
  if (!dialogue) return [{ speaker: 'NARRATOR', text: lines.join(' ') }];
  return lines.map((l) => ({ speaker: l[0], text: l.slice(3).trim() }));
}

export function buildClipSsml(clipKey: string, script: string): string {
  const casting = PROPOSED_CASTING[clipKey];
  if (!casting) throw new Error(`no casting for ${clipKey}`);
  const body = splitTurns(script)
    .map((turn, i) => {
      const voiceKey = casting[turn.speaker];
      if (!voiceKey)
        throw new Error(
          `${clipKey}: no voice cast for speaker ${turn.speaker}`,
        );
      const voice = LISTENING_VOICE_REGISTRY[voiceKey].providerVoice;
      const pause = i > 0 ? '<break time="450ms"/>' : '';
      return `<voice name="${voice}">${pause}${escapeXml(turn.text)}</voice>`;
    })
    .join('');
  return `<speak version="1.0" xml:lang="en-US" xmlns="http://www.w3.org/2001/10/synthesis">${body}</speak>`;
}

const sha256 = (v: string | Buffer) =>
  createHash('sha256').update(v).digest('hex');

function args() {
  const [mode, ...rest] = process.argv.slice(2);
  const get = (flag: string) => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  return {
    mode,
    target: get('--target'),
    out: get('--out') ?? 'artifacts/entry-diagnostic-v2-audio',
  };
}

async function connect(url: string, readOnly: boolean) {
  const u = new URL(url);
  if (readOnly)
    u.searchParams.set('options', '-c default_transaction_read_only=on');
  const prisma = new PrismaClient({
    datasources: { db: { url: u.toString() } },
  });
  const [id] = await prisma.$queryRawUnsafe<
    Array<{ db: string; sysid: string }>
  >(
    `SELECT current_database() AS db, (SELECT system_identifier::text FROM pg_control_system()) AS sysid`,
  );
  return {
    prisma,
    identity: id,
    isProtected: PROTECTED_CLUSTERS.includes(id.sysid),
  };
}

async function loadClips(prisma: PrismaClient) {
  const assessment = await prisma.diagnosticAssessment.findUnique({
    where: { sourceKey: ASSESSMENT_SOURCE_KEY },
  });
  if (!assessment) throw new Error('assessment DIAG_V2_ASSESSMENT not found');
  const rows = await prisma.diagnosticListeningClip.findMany({
    where: { question: { assessmentId: assessment.id } },
    orderBy: { id: 'asc' },
  });
  const draft = JSON.parse(
    readFileSync(
      join('artifacts', 'entry-diagnostic-v2-content-draft.json'),
      'utf8',
    ),
  );
  const approved = new Map<string, string>(
    draft.listening.clips.map((c: any) => [c.draftKey, c.script]),
  );
  const byClip = new Map<string, typeof rows>();
  const problems: string[] = [];
  for (const row of rows) {
    const clipKey = /(LST_CLIP_\d+)/.exec(row.storageKey)?.[1] ?? '';
    const script = approved.get(clipKey);
    if (!script)
      problems.push(`row ${row.id}: no approved script for ${row.storageKey}`);
    else if (script !== row.script || sha256(script) !== row.scriptSha256)
      problems.push(`row ${row.id}: script differs from the approved draft`);
    byClip.set(clipKey, [...(byClip.get(clipKey) ?? []), row]);
  }
  return { assessment, rows, byClip, approved, problems };
}

async function plan(url: string) {
  const { prisma, identity, isProtected } = await connect(url, true);
  const { assessment, rows, byClip, approved, problems } =
    await loadClips(prisma);
  console.log(
    `target ${identity.db} cluster ${identity.sysid}${isProtected ? ' (PROTECTED, read-only session)' : ''}`,
  );
  console.log(
    `assessment ${assessment.id} status=${assessment.status} isActive=${assessment.isActive} contentVersion=${assessment.contentVersion}`,
  );
  console.log(
    `clip rows: ${rows.length}; distinct scripts: ${byClip.size}; voice registry ${LISTENING_VOICE_REGISTRY_VERSION}`,
  );
  for (const [clipKey, clipRows] of byClip) {
    const script = approved.get(clipKey) ?? '';
    const turns = splitTurns(script);
    const casting = PROPOSED_CASTING[clipKey];
    console.log(
      `\n## ${clipKey}  questions ${clipRows.map((r) => r.questionId).join(',')}  rows ${clipRows.map((r) => r.id).join(',')}`,
    );
    console.log(
      `   pending: ${clipRows.every((r) => !r.isActive && r.storageKey.endsWith('.pending'))}; chars ${script.length}; turns ${turns.length}`,
    );
    console.log(
      `   casting: ${Object.entries(casting)
        .map(
          ([s, v]) =>
            `${s}=${v} (${LISTENING_VOICE_REGISTRY[v].providerVoice})`,
        )
        .join(', ')}`,
    );
    console.log(`   key: ${KEY_PREFIX}/${clipKey}.v1.mp3`);
    console.log(`   ssml sha256: ${sha256(buildClipSsml(clipKey, script))}`);
  }
  console.log(`\nproblems: ${problems.length ? problems.join('; ') : 'none'}`);
  console.log(
    `a publish would change: ${rows.length} DiagnosticListeningClip rows (storageKey,url,durationMs,byteSize,audioSha256,voice,generationSource,isActive) and ${rows.length} DiagnosticQuestion.options.audioUrl`,
  );
  await prisma.$disconnect();
  process.exit(problems.length ? 1 : 0);
}

function synthesize(ssml: string): Promise<Buffer> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region)
    throw new Error('AZURE_SPEECH_KEY/AZURE_SPEECH_REGION are not set');
  return new Promise((resolve, reject) => {
    const config = SpeechSDK.SpeechConfig.fromSubscription(key, region);
    config.speechSynthesisOutputFormat =
      SpeechSDK.SpeechSynthesisOutputFormat[OUTPUT_FORMAT];
    const synth = new SpeechSDK.SpeechSynthesizer(config, null);
    synth.speakSsmlAsync(
      ssml,
      (result) => {
        synth.close();
        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted)
          resolve(Buffer.from(result.audioData));
        else
          reject(
            new Error(
              `synthesis failed: ${SpeechSDK.ResultReason[result.reason]} ${result.errorDetails ?? ''}`.slice(
                0,
                300,
              ),
            ),
          );
      },
      (error) => {
        synth.close();
        reject(new Error(`synthesis failed: ${String(error).slice(0, 300)}`));
      },
    );
  });
}

async function generate(url: string, out: string) {
  if (process.env.DIAG_V2_TTS_AUTHORIZED !== 'generate-4-clips')
    throw new Error(
      'REFUSED: TTS generation is not authorized (DIAG_V2_TTS_AUTHORIZED)',
    );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const { prisma } = await connect(url, true);
  const { byClip, approved, problems } = await loadClips(prisma);
  await prisma.$disconnect();
  if (problems.length) throw new Error(`REFUSED: ${problems.join('; ')}`);
  mkdirSync(out, { recursive: true });
  const manifest: any[] = [];
  let calls = 0;
  for (const clipKey of byClip.keys()) {
    if (calls >= 4) throw new Error('HARD_CAP_REACHED: 4 syntheses');
    const script = approved.get(clipKey)!;
    const ssml = buildClipSsml(clipKey, script);
    calls += 1;
    const audio = await synthesize(ssml);
    const meta = await parseBuffer(audio, { mimeType: 'audio/mpeg' });
    const durationMs = Math.round((meta.format.duration ?? 0) * 1000);
    const file = join(out, `${clipKey}.v1.mp3`);
    writeFileSync(file, audio);
    manifest.push({
      clipKey,
      file,
      bytes: audio.length,
      durationMs,
      audioSha256: sha256(audio),
      scriptSha256: sha256(script),
      ssmlSha256: sha256(ssml),
      casting: PROPOSED_CASTING[clipKey],
      voiceRegistryVersion: LISTENING_VOICE_REGISTRY_VERSION,
      outputFormat: OUTPUT_FORMAT,
    });
    console.log(`${clipKey}: ${audio.length} bytes, ${durationMs} ms`);
  }
  writeFileSync(
    join(out, 'manifest.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), calls, clips: manifest },
      null,
      2,
    ),
  );
  console.log(`TTS calls: ${calls}; manifest ${join(out, 'manifest.json')}`);
}

async function publish(url: string, out: string) {
  if (process.env.DIAG_V2_AUDIO_PUBLISH_AUTHORIZED !== 'publish-4-clips')
    throw new Error(
      'REFUSED: publishing is not authorized (DIAG_V2_AUDIO_PUBLISH_AUTHORIZED)',
    );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  const { prisma, identity } = await connect(url, false);
  const { assessment, rows, byClip, approved, problems } =
    await loadClips(prisma);
  if (problems.length) throw new Error(`REFUSED: ${problems.join('; ')}`);
  if (assessment.status !== 'DRAFT' || assessment.isActive)
    throw new Error('REFUSED: assessment is not an inactive DRAFT');
  for (const clip of manifest.clips) {
    if (clip.scriptSha256 !== sha256(approved.get(clip.clipKey)!))
      throw new Error(
        `REFUSED: ${clip.clipKey} audio was generated from a different script`,
      );
    const audio = readFileSync(clip.file);
    if (sha256(audio) !== clip.audioSha256)
      throw new Error(`REFUSED: ${clip.clipKey} file changed after generation`);
  }
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const publicBase = process.env.R2_PUBLIC_URL!.replace(/\/$/, '');
  const urls = new Map<string, string>();
  for (const clip of manifest.clips) {
    const key = `${KEY_PREFIX}/${clip.clipKey}.v1.mp3`;
    const body = readFileSync(clip.file);
    const md5 = createHash('md5').update(body).digest('hex');
    // Never overwrite: an existing object must be this exact file.
    const existing = await s3
      .send(
        new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }),
      )
      .catch((e: { $metadata?: { httpStatusCode?: number } }) => {
        if (e?.$metadata?.httpStatusCode === 404) return null;
        throw e;
      });
    if (existing) {
      if ((existing.ETag ?? '').replace(/"/g, '') !== md5)
        throw new Error(
          `REFUSED: ${key} already exists with different content`,
        );
      console.log(`${key}: already uploaded (same content)`);
      urls.set(clip.clipKey, `${publicBase}/${key}`);
      continue;
    }
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: 'audio/mpeg',
      }),
    );
    urls.set(clip.clipKey, `${publicBase}/${key}`);
  }
  await prisma.$transaction(async (tx) => {
    for (const [clipKey, clipRows] of byClip) {
      const clip = manifest.clips.find((c: any) => c.clipKey === clipKey);
      for (const row of clipRows) {
        const changed = await tx.diagnosticListeningClip.updateMany({
          where: {
            id: row.id,
            isActive: false,
            storageKey: { endsWith: '.pending' },
          },
          data: {
            storageKey: `${KEY_PREFIX}/${clipKey}.v1.mp3`,
            url: urls.get(clipKey),
            durationMs: clip.durationMs,
            byteSize: clip.bytes,
            audioSha256: clip.audioSha256,
            voice: Object.values(clip.casting).join('+'),
            generationSource: `AZURE_TTS_${LISTENING_VOICE_REGISTRY_VERSION}`,
            isActive: true,
          },
        });
        if (changed.count !== 1)
          throw new Error(`clip row ${row.id} was not pending`);
        const q = await tx.diagnosticQuestion.findUniqueOrThrow({
          where: { id: row.questionId },
        });
        await tx.diagnosticQuestion.update({
          where: { id: row.questionId },
          data: {
            options: { ...(q.options as object), audioUrl: urls.get(clipKey) },
          },
        });
      }
    }
  });
  console.log(
    `published to ${identity.db}: ${rows.length} clip rows, ${rows.length} questions`,
  );
  await prisma.$disconnect();
}

async function harnessFixture(url: string) {
  const { prisma, identity, isProtected } = await connect(url, false);
  if (isProtected || ['kltn_db', 'kltn_shadow'].includes(identity.db))
    throw new Error('REFUSED: fixture mode is for the disposable clone only');
  const { rows } = await loadClips(prisma);
  const [artifact] = await prisma.listeningAudioArtifact.findMany({
    where: { status: 'PUBLISHED', r2Url: { not: null } },
    take: 1,
  });
  if (!artifact?.r2Url)
    throw new Error('no public practice MP3 available in the clone');
  for (const row of rows) {
    const q = await prisma.diagnosticQuestion.findUniqueOrThrow({
      where: { id: row.questionId },
    });
    await prisma.diagnosticQuestion.update({
      where: { id: row.questionId },
      data: { options: { ...(q.options as object), audioUrl: artifact.r2Url } },
    });
    await prisma.diagnosticListeningClip.update({
      where: { id: row.id },
      data: {
        url: artifact.r2Url,
        generationSource: 'HARNESS_FIXTURE_NOT_SCRIPT_AUDIO',
      },
    });
  }
  console.log(
    `clone ${identity.db}: ${rows.length} listening questions point at stand-in audio ${artifact.r2Url}`,
  );
  await prisma.$disconnect();
}

async function main() {
  const parsed = args();
  const { mode, out } = parsed;
  let target = parsed.target;
  // `env:DATABASE_URL` reads the URL from .env so it never appears on a command line.
  if (target === 'env:DATABASE_URL') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config({ quiet: true });
    target = process.env.DATABASE_URL;
  }
  if (!target) throw new Error('--target <database url> is required');
  if (mode === 'plan') return plan(target);
  if (mode === 'generate') return generate(target, out);
  if (mode === 'publish') return publish(target, out);
  if (mode === 'harness-fixture') return harnessFixture(target);
  throw new Error('mode must be plan | generate | publish | harness-fixture');
}

if (require.main === module)
  main().catch((e) => {
    console.error('STOPPED:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
