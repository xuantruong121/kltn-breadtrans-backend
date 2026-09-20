import 'dotenv/config';
import { PrismaClient, QuizType } from '@prisma/client';
import { buildNaturalListeningAudioText } from '../src/modules/quiz/quiz.service';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
const azureKey = process.env.AZURE_SPEECH_KEY;
const azureRegion = process.env.AZURE_SPEECH_REGION;

if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicUrl) {
  throw new Error('R2 credentials and R2_PUBLIC_URL are required.');
}
if (!azureKey || !azureRegion) {
  throw new Error('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required.');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

function escapeSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dialogueVoice(
  speaker: string,
  index: number,
  accent: 'US' | 'UK',
  speakerSlots: Map<string, number>,
): string {
  const normalized = speaker.toLocaleLowerCase('vi-VN');
  const isAgent =
    normalized.includes('agent') ||
    normalized.includes('support') ||
    normalized.includes('nhân viên') ||
    normalized.includes('assistant') ||
    normalized.includes('staff');
  const isCustomer =
    normalized.includes('customer') ||
    normalized.includes('caller') ||
    normalized.includes('client') ||
    normalized.includes('buyer') ||
    normalized.includes('guest');
  let slot = speakerSlots.get(normalized);
  if (slot === undefined) {
    slot = isAgent ? 1 : isCustomer ? 0 : speakerSlots.size % 2;
    speakerSlots.set(normalized, slot);
  }
  if (accent === 'UK') {
    return slot === 1 || (!normalized && index % 2 === 1)
      ? 'en-GB-SoniaNeural'
      : 'en-GB-RyanNeural';
  }
  return slot === 1 || (!normalized && index % 2 === 1)
    ? 'en-US-JennyNeural'
    : 'en-US-GuyNeural';
}

async function synthesize(text: string, accent: 'US' | 'UK'): Promise<Buffer> {
  const voice = accent === 'UK' ? 'en-GB-SoniaNeural' : 'en-US-JennyNeural';
  const lang = accent === 'UK' ? 'en-GB' : 'en-US';
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody rate='1.0'>${escapeSsml(text)}</prosody></voice></speak>`;
  const response = await fetch(
    `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey!,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'BreadtransListeningMaterializer',
      },
      body: ssml,
    },
  );
  if (!response.ok) {
    throw new Error(`Azure TTS failed with HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeDialogue(
  segments: Array<{ speaker: string; text: string }>,
  accent: 'US' | 'UK',
): Promise<Buffer> {
  const lang = accent === 'UK' ? 'en-GB' : 'en-US';
  const speakerSlots = new Map<string, number>();
  const body = segments
    .map(
      (segment, index) =>
        `<voice name='${dialogueVoice(segment.speaker, index, accent, speakerSlots)}'><prosody rate='1.0'>${escapeSsml(segment.text)}</prosody></voice>`,
    )
    .join('');
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>${body}</speak>`;
  const response = await fetch(
    `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey!,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'BreadtransListeningMaterializer',
      },
      body: ssml,
    },
  );
  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Azure dialogue TTS failed with HTTP ${response.status}: ${details}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const questions = await prisma.question.findMany({
    where: { quiz: { type: QuizType.LISTENING_PRACTICE } },
    select: {
      id: true,
      quizId: true,
      content: true,
      quiz: { select: { id: true, title: true } },
      audioAssets: { orderBy: { version: 'desc' }, take: 1 },
    },
    orderBy: [{ quizId: 'asc' }, { order: 'asc' }],
  });

  let created = 0;
  let skipped = 0;
  for (const question of questions) {
    const content = (question.content ?? {}) as Record<string, unknown>;
    const isDialogue =
      Array.isArray(content.transcriptSegments) &&
      content.transcriptSegments.length > 0;
    const text = buildNaturalListeningAudioText(content);
    if (!text) {
      skipped += 1;
      console.log(`[skip] q${question.id}: no audioText`);
      continue;
    }
    if (question.audioAssets[0]?.isActive && !isDialogue) {
      skipped += 1;
      console.log(
        `[skip] q${question.id}: active v${question.audioAssets[0].version}`,
      );
      continue;
    }

    const activeAsset = question.audioAssets[0];
    const alreadyNaturalized =
      isDialogue && activeAsset?.key.endsWith('/dialogue-v3.mp3');
    const version = alreadyNaturalized
      ? activeAsset.version
      : (activeAsset?.version ?? 0) + 1;
    const key = isDialogue
      ? `catalog/listening/practice/audio/quiz-${question.quizId}/question-${question.id}/dialogue-v3.mp3`
      : `catalog/listening/practice/audio/quiz-${question.quizId}/question-${question.id}/v${version}.mp3`;
    let buffer: Buffer;
    if (await objectExists(key)) {
      console.log(`[reuse] q${question.id}: ${key}`);
      buffer = Buffer.alloc(0);
    } else {
      const accent = content.accent === 'UK' ? 'UK' : 'US';
      console.log(`[tts] q${question.id} (${accent}) ${question.quiz.title}`);
      if (isDialogue) {
        const segments = (
          content.transcriptSegments as Array<Record<string, unknown>>
        )
          .filter((segment) => typeof segment.text === 'string')
          .map((segment) => ({
            speaker: typeof segment.speaker === 'string' ? segment.speaker : '',
            text: segment.text as string,
          }));
        buffer = await synthesizeDialogue(segments, accent);
      } else {
        buffer = await synthesize(text, accent);
      }
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: 'audio/mpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    }

    await prisma.$transaction(async (tx) => {
      await tx.quizAudioAsset.updateMany({
        where: { questionId: question.id },
        data: { isActive: false },
      });
      await tx.quizAudioAsset.upsert({
        where: { questionId_version: { questionId: question.id, version } },
        update: {
          key,
          url: `${publicUrl}/${key}`,
          mimeType: 'audio/mpeg',
          isActive: true,
        },
        create: {
          questionId: question.id,
          version,
          key,
          url: `${publicUrl}/${key}`,
          mimeType: 'audio/mpeg',
          isActive: true,
        },
      });
    });
    created += 1;
  }

  console.log(
    JSON.stringify({ total: questions.length, created, skipped }, null, 2),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
