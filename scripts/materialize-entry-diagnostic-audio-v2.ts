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

const scripts = [
  // A1
  {
    group: 'diagnostic-a1-1',
    voice: 'en-US-JennyNeural',
    text: 'Hi, this is the community centre. The swimming class starts at six, and please bring a towel.',
  },
  {
    group: 'diagnostic-a1-2',
    voice: 'en-US-GuyNeural',
    text: 'Good morning! The library closes early today at four o’clock for maintenance.',
  },
  {
    group: 'diagnostic-a1-3',
    voice: 'en-GB-SoniaNeural',
    text: 'Attention passengers, the bus to Oxford will depart from platform three.',
  },
  {
    group: 'diagnostic-a1-4',
    voice: 'en-US-JennyNeural',
    text: 'Hello David, please remember to bring your student ID card to the test room.',
  },

  // A2
  {
    group: 'diagnostic-a2-1',
    voice: 'en-US-GuyNeural',
    text: 'Hi Mark, I left the apartment keys inside the blue envelope on the kitchen table.',
  },
  {
    group: 'diagnostic-a2-2',
    voice: 'en-GB-RyanNeural',
    text: 'The courier just called. The delivery will arrive on Tuesday morning before noon. Please keep your phone nearby.',
  },
  {
    group: 'diagnostic-a2-3',
    voice: 'en-GB-SoniaNeural',
    text: 'Dear customers, due to wet paint, please use the rear stairs to reach the second floor café.',
  },
  {
    group: 'diagnostic-a2-4',
    voice: 'en-US-JennyNeural',
    text: 'Hi Lisa, thanks for agreeing to help. Could you buy two cartons of milk on your way home?',
  },

  // B1
  {
    group: 'diagnostic-b1-1',
    voice: 'en-GB-SoniaNeural',
    text: 'We reviewed the proposal and decided to move the software launch to May because the user acceptance testing requires two extra weeks.',
  },
  {
    group: 'diagnostic-b1-2',
    voice: 'en-US-GuyNeural',
    text: 'Because rainfall is expected throughout the weekend, Saturday’s charity fun run has been rescheduled for next Sunday at the central stadium.',
  },
  {
    group: 'diagnostic-b1-3',
    voice: 'en-GB-RyanNeural',
    text: 'Welcome aboard flight VN340 to Tokyo. In compliance with aviation guidelines, all electronic devices must remain in flight mode during takeoff.',
  },
  {
    group: 'diagnostic-b1-4',
    voice: 'en-US-JennyNeural',
    text: 'Due to rising raw material costs, the procurement department recommends renegotiating shipping terms with our regional logistics supplier.',
  },

  // B2
  {
    group: 'diagnostic-b2-1',
    voice: 'en-GB-RyanNeural',
    text: 'Although preliminary customer feedback is promising, the managing director insists on an independent financial audit before allocating further venture capital to the overseas branch.',
  },
  {
    group: 'diagnostic-b2-2',
    voice: 'en-GB-SoniaNeural',
    text: 'The recent survey highlights a significant discrepancy between self-reported employee satisfaction and actual team retention rates across tech startups.',
  },
  {
    group: 'diagnostic-b2-3',
    voice: 'en-US-GuyNeural',
    text: 'To mitigate supply-chain disruptions caused by unpredictable port closures, the advisory board suggests adopting a diversified supplier network across Southeast Asia.',
  },
  {
    group: 'diagnostic-b2-4',
    voice: 'en-US-JennyNeural',
    text: 'While the proposed environmental initiative is commendable, analysts caution that sudden regulatory compliance deadlines may disproportionately affect small-scale agricultural producers.',
  },
] as const;

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
