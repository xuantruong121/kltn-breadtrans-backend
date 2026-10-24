/**
 * Repair listening audio whose voice does not match the speaker (spec §11-§12).
 *
 * Forensics
 * ---------
 * The recovery pass that re-synthesized listening audio picked the TTS voice by
 * the order speakers were encountered inside one synthesis call, not by who was
 * speaking. Dictation questions carry exactly one turn each, so every question
 * started with an empty slot map, every speaker took slot 0, and slot 0 is the
 * male voice. Acoustic analysis of the regenerated files confirms it: Mia, Maya
 * and Nora all measure in the male range (119-156 Hz median F0), while the
 * surviving pre-incident whole-script audio has two clearly separated clusters
 * (quiz 23: 125 Hz and 217 Hz). The generator now resolves voices through the
 * canonical registry, and this script re-renders the affected questions.
 *
 * Selection is computed, not assumed: a question is repaired only when the
 * superseded algorithm and the canonical resolver disagree for one of its
 * turns. Nothing is deleted - the previous asset is deactivated and kept.
 *
 * Idempotent: a repaired question already has an active asset at the repair
 * version and is skipped.
 *
 * Usage:
 *   npx ts-node scripts/repair-listening-speaker-voices.ts
 *   npx ts-node scripts/repair-listening-speaker-voices.ts --apply
 */
import 'dotenv/config';
import { PrismaClient, QuizType } from '@prisma/client';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { resolveListeningVoice } from '../src/modules/quiz/listening-audio-authoring.service';
import {
  PRIVATE_LISTENING_MEDIA_PREFIX,
  isPrivateListeningMediaKey,
} from '../src/modules/upload/r2.service';

const APPLY = process.argv.includes('--apply');
const REPAIR_VERSION = 4;

const prisma = new PrismaClient();
const azureKey = process.env.AZURE_SPEECH_KEY;
const azureRegion = process.env.AZURE_SPEECH_REGION;
const publicBucket = process.env.R2_BUCKET_NAME;
const privateBucket = process.env.R2_PRIVATE_BUCKET_NAME;
const publicBase = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '');

const publicClient = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
  },
});
const privateClient = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_PRIVATE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_PRIVATE_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_PRIVATE_SECRET_ACCESS_KEY as string,
  },
});

/** The superseded algorithm, kept verbatim so the repair set is provable. */
function supersededVoice(
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

function canonicalVoice(speaker: string, index: number, accent: 'US' | 'UK') {
  const named = speaker.trim();
  return resolveListeningVoice(
    named,
    accent,
    undefined,
    named ? undefined : index,
  ).providerVoice;
}

const escapeSsml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

async function synthesize(
  segments: Array<{ speaker: string; text: string }>,
  accent: 'US' | 'UK',
): Promise<Buffer> {
  const lang = accent === 'UK' ? 'en-GB' : 'en-US';
  const body = segments
    .map(
      (segment, index) =>
        `<voice name='${canonicalVoice(segment.speaker, index, accent)}'><prosody rate='1.0'>${escapeSsml(segment.text)}</prosody></voice>`,
    )
    .join('');
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>${body}</speak>`;
  const response = await fetch(
    `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey as string,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'BreadtransSpeakerVoiceRepair',
      },
      body: ssml,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Azure TTS failed: HTTP ${response.status} ${(await response.text()).slice(0, 160)}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) {
    throw new Error('synthesized audio is suspiciously small');
  }
  return buffer;
}

type Target = {
  quizId: number;
  questionId: number;
  accent: 'US' | 'UK';
  isPremium: boolean;
  segments: Array<{ speaker: string; text: string }>;
  diffs: string[];
};

async function collectTargets(): Promise<Target[]> {
  const quizzes = await prisma.quiz.findMany({
    where: {
      type: QuizType.LISTENING_PRACTICE,
      publicationStatus: 'PUBLISHED',
    },
    select: {
      id: true,
      isPremiumContent: true,
      questions: {
        select: {
          id: true,
          order: true,
          content: true,
          audioAssets: { orderBy: { version: 'desc' } },
        },
        orderBy: { order: 'asc' },
      },
    },
    orderBy: { id: 'asc' },
  });

  const targets: Target[] = [];
  for (const quiz of quizzes) {
    for (const question of quiz.questions) {
      const content = (question.content ?? {}) as Record<string, unknown>;
      const accent = content.accent === 'UK' ? 'UK' : 'US';
      const raw = Array.isArray(content.transcriptSegments)
        ? (content.transcriptSegments as Array<Record<string, unknown>>)
        : [];
      const segments = raw
        .filter((segment) => typeof segment.text === 'string')
        .map((segment) => ({
          speaker: typeof segment.speaker === 'string' ? segment.speaker : '',
          text: segment.text as string,
        }));
      if (!segments.length) continue;

      const slots = new Map<string, number>();
      const diffs: string[] = [];
      segments.forEach((segment, index) => {
        const before = supersededVoice(segment.speaker, index, accent, slots);
        const after = canonicalVoice(segment.speaker, index, accent);
        if (before !== after) {
          diffs.push(
            `${segment.speaker || '(unnamed)'}: ${before} -> ${after}`,
          );
        }
      });
      if (!diffs.length) continue;

      const active = question.audioAssets.find((asset) => asset.isActive);
      if (active && active.version >= REPAIR_VERSION) continue;

      targets.push({
        quizId: quiz.id,
        questionId: question.id,
        accent,
        isPremium: quiz.isPremiumContent,
        segments,
        diffs,
      });
    }
  }
  return targets;
}

async function main() {
  if (APPLY && (!azureKey || !azureRegion)) {
    throw new Error(
      'AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required to apply',
    );
  }

  const targets = await collectTargets();
  console.log(
    `speaker-voice repair${APPLY ? '' : ' (dry run)'}: ${targets.length} question(s) where the superseded and canonical voices disagree`,
  );
  const byQuiz: Record<number, number> = {};
  for (const target of targets) {
    byQuiz[target.quizId] = (byQuiz[target.quizId] ?? 0) + 1;
  }
  console.log(`  per quiz: ${JSON.stringify(byQuiz)}`);
  for (const target of targets.slice(0, 6)) {
    console.log(
      `  q${target.questionId} (quiz ${target.quizId}): ${target.diffs.join(' | ')}`,
    );
  }
  if (targets.length > 6) {
    console.log(`  ... and ${targets.length - 6} more`);
  }

  if (!APPLY) {
    console.log(
      '\nre-run with --apply to synthesize and publish the corrected audio',
    );
    return;
  }

  let repaired = 0;
  for (const target of targets) {
    const key = target.isPremium
      ? `${PRIVATE_LISTENING_MEDIA_PREFIX}quiz-${target.quizId}/question-${target.questionId}/dialogue-v${REPAIR_VERSION}.mp3`
      : `catalog/listening/practice/audio/quiz-${target.quizId}/question-${target.questionId}/dialogue-v${REPAIR_VERSION}.mp3`;
    const buffer = await synthesize(target.segments, target.accent);
    const client = target.isPremium ? privateClient : publicClient;
    const bucket = target.isPremium ? privateBucket : publicBucket;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: 'audio/mpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    // A private object must never carry a public URL. QuizAudioAsset.url is a
    // required column, and the premium rollout stores an empty string for
    // gated media, so that convention is kept here.
    const url = isPrivateListeningMediaKey(key) ? '' : `${publicBase}/${key}`;

    await prisma.$transaction(async (tx) => {
      await tx.quizAudioAsset.updateMany({
        where: { questionId: target.questionId, isActive: true },
        data: { isActive: false },
      });
      await tx.quizAudioAsset.upsert({
        where: {
          questionId_version: {
            questionId: target.questionId,
            version: REPAIR_VERSION,
          },
        },
        update: { key, url, isActive: true, mimeType: 'audio/mpeg' },
        create: {
          questionId: target.questionId,
          version: REPAIR_VERSION,
          key,
          url,
          isActive: true,
          mimeType: 'audio/mpeg',
        },
      });
    });
    repaired++;
    console.log(
      `  repaired q${target.questionId} -> ${key} (${buffer.length} bytes)`,
    );
  }
  console.log(`\nSPEAKER_VOICE_REPAIRED=${repaired}`);
}

void main()
  .catch((error: unknown) => {
    console.error(
      'Speaker-voice repair failed:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
