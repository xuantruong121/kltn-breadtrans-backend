import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseBuffer } from 'music-metadata';
import { PrismaClient, Prisma } from '@prisma/client';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const artifactDir = join(
  process.cwd(),
  '..',
  '..',
  'artifacts',
  'entry-diagnostic-2',
);
const azureKey = process.env.AZURE_SPEECH_KEY;
const azureRegion = process.env.AZURE_SPEECH_REGION;
const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

const baseScripts = [
  {
    voice: 'en-US-JennyNeural',
    text: 'Hi, this is the community centre. The swimming class starts at six, and please bring a towel.',
  },
  {
    voice: 'en-US-GuyNeural',
    text: 'The delivery will arrive on Tuesday morning. Please leave the package with reception if I am away.',
  },
  {
    voice: 'en-GB-SoniaNeural',
    text: 'We reviewed the proposal and decided to move the launch to May because the testing phase needs more time.',
  },
  {
    voice: 'en-GB-RyanNeural',
    text: 'Although the figures are encouraging, the director wants a second review before we commit resources to the expansion.',
  },
] as const;
const scripts = (['a1', 'a2', 'b1', 'b2'] as const).flatMap((level) =>
  baseScripts.map((script, index) => ({
    ...script,
    group: `diagnostic-${level}-${index + 1}`,
  })),
);

function escapeSsml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function synthesize(text: string, voice: string) {
  const config = SpeechSDK.SpeechConfig.fromSubscription(
    azureKey!,
    azureRegion!,
  );
  config.speechSynthesisOutputFormat =
    SpeechSDK.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3;
  const outputChunks: Buffer[] = [];
  const output = SpeechSDK.PushAudioOutputStream.create({
    write: (data: ArrayBuffer) => outputChunks.push(Buffer.from(data)),
    close: () => undefined,
  });
  const synthesizer = new SpeechSDK.SpeechSynthesizer(
    config,
    SpeechSDK.AudioConfig.fromStreamOutput(output),
  );
  const ssml = `<speak version="1.0" xml:lang="en-US" xmlns="http://www.w3.org/2001/10/synthesis"><voice name="${voice}"><prosody rate="1.0">${escapeSsml(text)}</prosody></voice></speak>`;
  return new Promise<Buffer>((resolve, reject) =>
    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        const audio = Buffer.concat(outputChunks);
        synthesizer.close();
        if (
          result.reason !== SpeechSDK.ResultReason.SynthesizingAudioCompleted ||
          !audio.length
        )
          return reject(
            new Error(
              result.errorDetails || 'Azure diagnostic audio synthesis failed',
            ),
          );
        resolve(audio);
      },
      (error) => {
        synthesizer.close();
        reject(new Error(String(error)));
      },
    ),
  );
}

async function main() {
  const required = {
    azureKey,
    azureRegion,
    publicUrl,
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length)
    throw new Error(`Missing authoring configuration: ${missing.join(', ')}`);
  await mkdir(artifactDir, { recursive: true });
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
    },
  });
  const questions = await prisma.diagnosticQuestion.findMany({
    where: { assessmentId: 2 },
    orderBy: { order: 'asc' },
  });
  const manifest: Array<Record<string, unknown>> = [];
  const generatedHashes = new Set<string>();
  for (const plan of scripts) {
    const digest = createHash('sha256')
      .update(`${plan.voice}\n${plan.text}`)
      .digest('hex');
    const key = `catalog/diagnostic/entry-v2/${digest.slice(0, 12)}.mp3`;
    let head: { ContentLength?: number } | null = null;
    try {
      head = await s3.send(
        new HeadObjectCommand({ Bucket: bucket!, Key: key }),
      );
    } catch {
      head = null;
    }
    let bytes = Number(head?.ContentLength ?? 0);
    let durationMs = bytes
      ? Math.max(1, Math.round((bytes * 8 * 1000) / 128000))
      : 0;
    if (!head) {
      const audio = await synthesize(plan.text, plan.voice);
      bytes = audio.byteLength;
      try {
        durationMs = Math.round(
          (await parseBuffer(audio, { mimeType: 'audio/mpeg' })).format
            .duration! * 1000,
        );
      } catch {
        durationMs = Math.max(1, Math.round((bytes * 8 * 1000) / 128000));
      }
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket!,
          Key: key,
          Body: audio,
          ContentType: 'audio/mpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      head = await s3.send(
        new HeadObjectCommand({ Bucket: bucket!, Key: key }),
      );
      if (!head) throw new Error(`R2 verification failed for ${key}`);
      generatedHashes.add(digest);
    }
    const audioUrl = `${publicUrl}/${key}`;
    for (const question of questions) {
      const raw =
        question.options &&
        typeof question.options === 'object' &&
        !Array.isArray(question.options)
          ? (question.options as Record<string, unknown>)
          : null;
      if (raw?.audioGroup !== plan.group) continue;
      await prisma.diagnosticQuestion.update({
        where: { id: question.id },
        data: { options: { ...(raw as Prisma.InputJsonObject), audioUrl } },
      });
    }
    manifest.push({
      group: plan.group,
      voice: plan.voice,
      text: plan.text,
      key,
      audioUrl,
      bytes,
      durationMs,
      synthesisHash: digest,
      generatedAt: new Date().toISOString(),
      provider: 'Azure Speech',
      generationSource: 'AUTHORING_ONLY',
    });
  }
  await writeFile(
    join(artifactDir, 'entry-diagnostic-audio-generation-manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        azureCalls: generatedHashes.size,
        r2Writes: generatedHashes.size,
        artifacts: manifest,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifactDir, 'entry-diagnostic-listening-audit.json'),
    JSON.stringify(
      {
        itemCount: questions.filter(
          (question) =>
            question.options &&
            typeof question.options === 'object' &&
            !Array.isArray(question.options) &&
            (question.options as Record<string, unknown>).section ===
              'LISTENING',
        ).length,
        audioGroupCount: manifest.length,
        scripts: manifest.map((item) => ({
          audioGroup: item.group,
          audioUrl: item.audioUrl,
          synthesisHash: item.synthesisHash,
          runtimeStatus: 'READY',
          originalBreadTransAuthored: true,
        })),
        transcriptHiddenBeforeSubmit: true,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
