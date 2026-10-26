/**
 * Spoken question audio for the TOEIC Speaking exam tasks that ETS presents
 * as audio (Q5-7 respond to questions, Q8-10 respond using information,
 * Q11 express an opinion). The approved question text of each task is read
 * aloud; nothing new is written. The TOEIC S&W and 4 Skills sets share the
 * same texts, so each distinct text is synthesized ONCE and both tasks point
 * at the same clip.
 *
 * Modes:
 *   plan      read-only: distinct texts, characters, target keys.
 *   generate  Azure neural TTS (F0), one call per distinct text, hard cap 10.
 *             Needs EXAM_PROMPT_TTS_AUTHORIZED=generate.
 *   publish   uploads each clip once (refusing to overwrite a different
 *             object) and sets audioUrl only where it is still null.
 *             Needs EXAM_PROMPT_AUDIO_PUBLISH_AUTHORIZED=publish.
 *
 * Usage: npx ts-node --transpile-only scripts/speaking-exam-prompt-audio.ts <mode> --target env:DATABASE_URL
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
} from '../src/modules/quiz/listening-audio-authoring.service';

const OUT = 'artifacts/speaking-exam-prompt-audio';
const MAX_CALLS = 10;
const AUDIO_TASKS = [
  'RESPOND_TO_QUESTION',
  'RESPOND_USING_INFORMATION',
  'EXPRESS_OPINION',
] as const;
const sha256 = (v: string | Buffer) =>
  createHash('sha256').update(v).digest('hex');
const keyFor = (text: string) =>
  `catalog/speaking/exam-prompt/${sha256(text.trim()).slice(0, 16)}.v1.mp3`;

function synthesize(text: string): Promise<Buffer> {
  const voice = LISTENING_VOICE_REGISTRY['en-us-female-01'].providerVoice;
  const ssml = `<speak version="1.0" xml:lang="en-US" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voice}">${escapeXml(text.trim())}</voice></speak>`;
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

async function main() {
  const [mode, , target] = process.argv.slice(2);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url) throw new Error('--target env:DATABASE_URL | <url> is required');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const exercises = await prisma.speakingExercise.findMany({
    where: {
      audioUrl: null,
      taskType: { in: [...AUDIO_TASKS] },
      practiceSet: { scope: 'EXAM_INTERNAL' },
    },
    select: { id: true, targetText: true, order: true, practiceSetId: true },
    orderBy: [{ practiceSetId: 'asc' }, { order: 'asc' }],
  });
  const byText = new Map<string, number[]>();
  for (const e of exercises) {
    const text = e.targetText.trim();
    byText.set(text, [...(byText.get(text) ?? []), e.id]);
  }

  if (mode === 'plan') {
    for (const [text, ids] of byText)
      console.log(
        `${keyFor(text)} <- exercises ${ids.join(',')} (${text.length} chars)`,
      );
    console.log(
      `tasks without audio: ${exercises.length}; distinct texts: ${byText.size}; characters: ${[...byText.keys()].reduce((n, t) => n + t.length, 0)}`,
    );
  } else if (mode === 'generate') {
    if (process.env.EXAM_PROMPT_TTS_AUTHORIZED !== 'generate')
      throw new Error('REFUSED: EXAM_PROMPT_TTS_AUTHORIZED=generate not set');
    if (byText.size > MAX_CALLS) throw new Error('HARD_CAP_EXCEEDED');
    mkdirSync(OUT, { recursive: true });
    const clips: unknown[] = [];
    for (const [text, ids] of byText) {
      const audio = await synthesize(text);
      const meta = await parseBuffer(audio, { mimeType: 'audio/mpeg' });
      const durationMs = Math.round((meta.format.duration ?? 0) * 1000);
      if (durationMs < 500) throw new Error(`empty audio for ${ids.join(',')}`);
      const file = join(OUT, keyFor(text).split('/').pop()!);
      writeFileSync(file, audio);
      clips.push({
        key: keyFor(text),
        file,
        ids,
        durationMs,
        textSha256: sha256(text),
        audioSha256: sha256(audio),
      });
      console.log(`${keyFor(text)}: ${durationMs} ms for ${ids.join(',')}`);
    }
    writeFileSync(
      join(OUT, 'manifest.json'),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), calls: clips.length, clips },
        null,
        2,
      ),
    );
    console.log(`TTS calls: ${clips.length}`);
  } else if (mode === 'publish') {
    if (process.env.EXAM_PROMPT_AUDIO_PUBLISH_AUTHORIZED !== 'publish')
      throw new Error(
        'REFUSED: EXAM_PROMPT_AUDIO_PUBLISH_AUTHORIZED=publish not set',
      );
    const manifest = JSON.parse(
      readFileSync(join(OUT, 'manifest.json'), 'utf8'),
    );
    const client = new S3Client({
      region: 'auto',
      endpoint:
        process.env.R2_ENDPOINT ||
        `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const bucket = process.env.R2_BUCKET_NAME!;
    const base = process.env.R2_PUBLIC_URL!.replace(/\/$/, '');
    const updates: Array<[number, string]> = [];
    for (const clip of manifest.clips) {
      const text = [...byText.keys()].find(
        (t) => sha256(t) === clip.textSha256,
      );
      if (!text)
        throw new Error(
          `REFUSED: text for ${clip.key} changed or already has audio`,
        );
      const body = readFileSync(clip.file);
      if (sha256(body) !== clip.audioSha256)
        throw new Error(`REFUSED: ${clip.file} changed`);
      const md5 = createHash('md5').update(body).digest('hex');
      const head = await client
        .send(new HeadObjectCommand({ Bucket: bucket, Key: clip.key }))
        .catch((e: { $metadata?: { httpStatusCode?: number } }) => {
          if (e?.$metadata?.httpStatusCode === 404) return null;
          throw e;
        });
      if (head && (head.ETag ?? '').replace(/"/g, '') !== md5)
        throw new Error(`REFUSED: ${clip.key} exists with different content`);
      if (!head)
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: clip.key,
            Body: body,
            ContentType: 'audio/mpeg',
          }),
        );
      console.log(`${clip.key}: ${head ? 'exists' : 'uploaded'}`);
      for (const id of byText.get(text)!)
        updates.push([id, `${base}/${clip.key}`]);
    }
    await prisma.$transaction(async (tx) => {
      for (const [id, audioUrl] of updates) {
        const changed = await tx.speakingExercise.updateMany({
          where: { id, audioUrl: null },
          data: { audioUrl },
        });
        if (changed.count !== 1)
          throw new Error(`exercise ${id} was not empty`);
      }
    });
    console.log(`exercises updated: ${updates.length}`);
  } else {
    throw new Error('mode must be plan | generate | publish');
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('STOPPED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
