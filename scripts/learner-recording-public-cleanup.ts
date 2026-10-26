/**
 * Learner Speaking recordings that were written to the PUBLIC bucket before
 * recordings moved to the private bucket (premium/speaking/practice/...).
 *
 *   list   read-only: counts the .wav objects under the two learner
 *          prefixes and says which ones the database still references.
 *   delete deletes exactly those .wav objects (never anything else).
 *          Needs LEARNER_RECORDING_DELETE_AUTHORIZED=delete. Referenced rows
 *          (SpeakingSubmission.audioKey) keep their key; their playback then
 *          returns "not found", which is the intended outcome for mock data.
 *
 * Keys are never printed in full: recordings are private learner data.
 * Usage: npx ts-node scripts/learner-recording-public-cleanup.ts list|delete
 */
import 'dotenv/config';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

const PREFIXES = ['speaking/pending/', 'catalog/speaking/submissions/'];

async function main() {
  const mode = process.argv[2];
  const e = process.env;
  const client = new S3Client({
    region: 'auto',
    endpoint:
      e.R2_ENDPOINT || `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: e.R2_ACCESS_KEY_ID!,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY!,
    },
  });
  const keys: string[] = [];
  for (const Prefix of PREFIXES) {
    let ContinuationToken: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: e.R2_BUCKET_NAME!,
          Prefix,
          ContinuationToken,
        }),
      );
      for (const o of page.Contents ?? [])
        if (o.Key?.endsWith('.wav')) keys.push(o.Key);
      ContinuationToken = page.NextContinuationToken;
    } while (ContinuationToken);
  }
  const prisma = new PrismaClient();
  const referenced = await prisma.speakingSubmission.findMany({
    where: { audioKey: { in: keys } },
    select: { id: true },
  });
  await prisma.$disconnect();
  console.log(
    `public learner recordings: ${keys.length}; referenced by submissions: ${referenced.map((r) => r.id).join(', ') || 'none'}`,
  );
  if (mode !== 'delete') return;
  if (e.LEARNER_RECORDING_DELETE_AUTHORIZED !== 'delete')
    throw new Error(
      'REFUSED: LEARNER_RECORDING_DELETE_AUTHORIZED=delete not set',
    );
  let deleted = 0;
  for (const Key of keys) {
    await client.send(
      new DeleteObjectCommand({ Bucket: e.R2_BUCKET_NAME!, Key }),
    );
    deleted += 1;
  }
  console.log(`deleted: ${deleted}`);
}

main().catch((error) => {
  console.error('STOPPED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
