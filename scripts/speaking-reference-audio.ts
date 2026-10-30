/**
 * Reference audio for the published Speaking practice exercises.
 *
 * The practice room plays only approved exercise media (`audioUrl`); none of
 * the 30 exercises had any, so "Nghe mẫu" was always disabled. This tool
 * makes that media from each exercise's own text:
 *   - READ_ALOUD / PRONUNCIATION_DRILL: a model reading of the exact text the
 *     learner reads;
 *   - question tasks (respond, opinion, describe a picture, respond using
 *     information): the prompt read aloud. No model answer is invented.
 *
 * Modes:
 *   plan      read-only; lists what would be generated and published.
 *   generate  Azure neural TTS (F0), one call per exercise, hard cap 30;
 *             writes MP3s + manifest to artifacts/speaking-reference-audio.
 *             Needs SPEAKING_REF_TTS_AUTHORIZED=generate.
 *   publish   uploads (never overwriting a different object) and sets
 *             audioUrl only where it is still null, in one transaction.
 *             Free exercises: public URL. Premium: private key under
 *             premium/speaking/ (served presigned by SpeakingService).
 *             Needs SPEAKING_REF_AUDIO_PUBLISH_AUTHORIZED=publish.
 *
 * British English variant: SPEAKING_REF_ACCENT=en-gb makes the same clips
 * with en-GB voices for the exercises that already have their US clip, as
 * <id>.en-gb.v1.mp3 beside it. Publish only uploads; no database field
 * changes, the API derives the UK URL from the US one.
 *
 * SPEAKING_REF_SET_IDS=<ids> targets the exercises of those practice sets
 * (hard cap 60) instead of the published standalone exercises.
 *
 * Usage: npx ts-node --transpile-only scripts/speaking-reference-audio.ts <mode> --target env:DATABASE_URL
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

const UK = process.env.SPEAKING_REF_ACCENT === 'en-gb';
const OUT = UK
  ? 'artifacts/speaking-reference-audio-en-gb'
  : 'artifacts/speaking-reference-audio';
// SPEAKING_REF_SET_IDS=<id,id,...>: the exercises of these practice sets
// (any publication status, e.g. new DRAFT sets awaiting review) instead of
// the published standalone exercises.
const SET_IDS = (process.env.SPEAKING_REF_SET_IDS ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const MAX_CALLS = SET_IDS.length ? 60 : 30;
const READ_TASKS = new Set(['READ_ALOUD', 'PRONUNCIATION_DRILL']);
const sha256 = (v: string | Buffer) =>
  createHash('sha256').update(v).digest('hex');

type Exercise = {
  id: number;
  taskType: string | null;
  targetText: string;
  isPremiumContent: boolean;
};

/** Reading tasks alternate voices by id; prompts use one steady voice. */
function voiceFor(ex: Exercise): keyof typeof LISTENING_VOICE_REGISTRY {
  const female = UK ? 'en-gb-female-01' : 'en-us-female-01';
  const male = UK ? 'en-gb-male-01' : 'en-us-male-01';
  if (!READ_TASKS.has(ex.taskType ?? '')) return female;
  return ex.id % 2 === 0 ? female : male;
}

function ssmlFor(ex: Exercise) {
  const voice = LISTENING_VOICE_REGISTRY[voiceFor(ex)].providerVoice;
  return `<speak version="1.0" xml:lang="${UK ? 'en-GB' : 'en-US'}" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voice}">${escapeXml(ex.targetText.trim())}</voice></speak>`;
}

function keyFor(ex: Exercise) {
  const file = `${ex.id}.${UK ? 'en-gb.' : ''}v1.mp3`;
  return ex.isPremiumContent
    ? `premium/speaking/reference/${file}`
    : `catalog/speaking/reference/${file}`;
}

async function load(prisma: PrismaClient): Promise<Exercise[]> {
  return prisma.speakingExercise.findMany({
    where: {
      ...(SET_IDS.length
        ? { practiceSetId: { in: SET_IDS } }
        : { practiceSetId: null, publicationStatus: 'PUBLISHED' }),
      // The UK pass covers exactly the exercises whose US clip this tool made.
      audioUrl: UK ? { contains: '/speaking/reference/' } : null,
    },
    select: {
      id: true,
      taskType: true,
      targetText: true,
      isPremiumContent: true,
    },
    orderBy: { id: 'asc' },
  });
}

function synthesize(ssml: string): Promise<Buffer> {
  const config = SpeechSDK.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY as string,
    process.env.AZURE_SPEECH_REGION as string,
  );
  config.speechSynthesisOutputFormat =
    SpeechSDK.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3;
  const synth = new SpeechSDK.SpeechSynthesizer(config, null);
  return new Promise((resolve, reject) =>
    synth.speakSsmlAsync(
      ssml,
      (result) => {
        synth.close();
        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted)
          resolve(Buffer.from(result.audioData));
        else
          reject(new Error(`synthesis failed: ${result.errorDetails ?? ''}`));
      },
      (error) => {
        synth.close();
        reject(new Error(`synthesis failed: ${String(error).slice(0, 200)}`));
      },
    ),
  );
}

function clients() {
  const endpoint =
    process.env.R2_ENDPOINT ||
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const publicClient = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const privateClient = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_PRIVATE_ENDPOINT || endpoint,
    credentials: {
      accessKeyId:
        process.env.R2_PRIVATE_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey:
        process.env.R2_PRIVATE_SECRET_ACCESS_KEY ||
        process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: Boolean(process.env.R2_PRIVATE_ENDPOINT),
  });
  return { publicClient, privateClient };
}

/** Uploads unless an identical object exists; refuses a different one. */
async function putOnce(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
) {
  const md5 = createHash('md5').update(body).digest('hex');
  const existing = await client
    .send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    .catch((e: { $metadata?: { httpStatusCode?: number } }) => {
      if (e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    });
  if (existing) {
    if ((existing.ETag ?? '').replace(/"/g, '') !== md5)
      throw new Error(`REFUSED: ${key} exists with different content`);
    return 'exists';
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'audio/mpeg',
    }),
  );
  return 'uploaded';
}

async function main() {
  const [mode, , target] = process.argv.slice(2);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url) throw new Error('--target env:DATABASE_URL | <url> is required');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const exercises = await load(prisma);

  if (mode === 'plan') {
    for (const ex of exercises)
      console.log(
        `${ex.id} ${ex.taskType} ${ex.isPremiumContent ? 'premium' : 'free'} ${voiceFor(ex)} ${ex.targetText.length} chars -> ${keyFor(ex)}`,
      );
    console.log(
      `exercises without audio: ${exercises.length}; characters: ${exercises.reduce((n, e) => n + e.targetText.length, 0)}`,
    );
  } else if (mode === 'generate') {
    if (process.env.SPEAKING_REF_TTS_AUTHORIZED !== 'generate')
      throw new Error('REFUSED: SPEAKING_REF_TTS_AUTHORIZED=generate not set');
    if (exercises.length > MAX_CALLS) throw new Error('HARD_CAP_EXCEEDED');
    mkdirSync(OUT, { recursive: true });
    const clips: unknown[] = [];
    for (const ex of exercises) {
      const audio = await synthesize(ssmlFor(ex));
      const meta = await parseBuffer(audio, { mimeType: 'audio/mpeg' });
      const durationMs = Math.round((meta.format.duration ?? 0) * 1000);
      if (durationMs < 500) throw new Error(`exercise ${ex.id}: empty audio`);
      const file = join(OUT, keyFor(ex).split('/').pop()!);
      writeFileSync(file, audio);
      clips.push({
        id: ex.id,
        taskType: ex.taskType,
        premium: ex.isPremiumContent,
        file,
        key: keyFor(ex),
        voice: voiceFor(ex),
        durationMs,
        bytes: audio.length,
        audioSha256: sha256(audio),
        textSha256: sha256(ex.targetText),
      });
      console.log(`${ex.id}: ${durationMs} ms`);
    }
    writeFileSync(
      join(OUT, 'manifest.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          calls: clips.length,
          voiceRegistryVersion: LISTENING_VOICE_REGISTRY_VERSION,
          clips,
        },
        null,
        2,
      ),
    );
    console.log(`TTS calls: ${clips.length}`);
  } else if (mode === 'publish') {
    if (process.env.SPEAKING_REF_AUDIO_PUBLISH_AUTHORIZED !== 'publish')
      throw new Error(
        'REFUSED: SPEAKING_REF_AUDIO_PUBLISH_AUTHORIZED=publish not set',
      );
    const manifest = JSON.parse(
      readFileSync(join(OUT, 'manifest.json'), 'utf8'),
    );
    const { publicClient, privateClient } = clients();
    const publicBase = process.env.R2_PUBLIC_URL!.replace(/\/$/, '');
    const values = new Map<number, string>();
    for (const clip of manifest.clips) {
      const ex = exercises.find((e) => e.id === clip.id);
      if (!ex)
        throw new Error(
          `REFUSED: exercise ${clip.id} already has audio or is gone`,
        );
      if (sha256(ex.targetText) !== clip.textSha256)
        throw new Error(
          `REFUSED: exercise ${clip.id} text changed since generation`,
        );
      const body = readFileSync(clip.file);
      if (sha256(body) !== clip.audioSha256)
        throw new Error(`REFUSED: ${clip.file} changed since generation`);
      const result = ex.isPremiumContent
        ? await putOnce(
            privateClient,
            process.env.R2_PRIVATE_BUCKET_NAME!,
            clip.key,
            body,
          )
        : await putOnce(
            publicClient,
            process.env.R2_BUCKET_NAME!,
            clip.key,
            body,
          );
      values.set(
        ex.id,
        ex.isPremiumContent ? clip.key : `${publicBase}/${clip.key}`,
      );
      console.log(`${clip.key}: ${result}`);
    }
    if (UK) {
      console.log(`uploaded UK clips: ${values.size}; database unchanged`);
      await prisma.$disconnect();
      return;
    }
    await prisma.$transaction(async (tx) => {
      for (const [id, audioUrl] of values) {
        const changed = await tx.speakingExercise.updateMany({
          where: {
            id,
            audioUrl: null,
            practiceSetId: SET_IDS.length ? { in: SET_IDS } : null,
          },
          data: { audioUrl },
        });
        if (changed.count !== 1)
          throw new Error(`exercise ${id} was not empty`);
      }
    });
    console.log(`published: ${values.size} exercises`);
  } else {
    throw new Error('mode must be plan | generate | publish');
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('STOPPED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
