import 'dotenv/config';
import { createHash } from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { parseEncodedMp3DurationMs } from '../src/modules/quiz/listening-media-metadata';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const identities = [
  { quizId: 23, artifactId: 14, version: 5, checksum: '8f454d8b4fce83b606a99dad2b99dfdc6f4871ab655e138c5cdfd23e62ad90e6' },
  { quizId: 24, artifactId: 15, version: 5, checksum: '55eef3045740a8bc35be23c1b06f38deb0905533d8ca4f86c0ca19e502e28bee' },
  { quizId: 25, artifactId: 16, version: 5, checksum: '74b71b1f683304d493fe4bed7abb599c53dc01ef3f8bf1d9372fb9a63372cf1f' },
] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  const stream = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (stream && typeof stream.transformToByteArray === 'function') {
    return Buffer.from(await stream.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main() {
  const accountId = required('R2_ACCOUNT_ID');
  const bucket = required('R2_BUCKET_NAME');
  const accessKeyId = required('R2_ACCESS_KEY_ID');
  const secretAccessKey = required('R2_SECRET_ACCESS_KEY');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log(`${apply ? 'APPLY' : 'DRY-RUN'}: verified MP3 duration reconciliation`);
  for (const identity of identities) {
    const artifact = await prisma.listeningAudioArtifact.findUnique({
      where: { id: identity.artifactId },
    });
    if (!artifact || artifact.quizId !== identity.quizId || artifact.version !== identity.version || artifact.checksumSha256 !== identity.checksum) {
      throw new Error(`Artifact identity mismatch for quiz ${identity.quizId}; no metadata was changed.`);
    }
    if (artifact.status !== 'PUBLISHED' || !artifact.r2Key) {
      throw new Error(`Artifact ${identity.artifactId} is not a published R2 artifact.`);
    }
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: artifact.r2Key }));
    if (!response.Body) throw new Error(`R2 object body is empty: ${artifact.r2Key}`);
    const bytes = await bodyToBuffer(response.Body);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (checksum !== identity.checksum) throw new Error(`R2 checksum mismatch for quiz ${identity.quizId}.`);
    const durationMs = await parseEncodedMp3DurationMs(bytes);
    const timeline = Array.isArray(artifact.timeline) ? (artifact.timeline as unknown[]) : [];
    const timelineMax = timeline.reduce<number>((max, item) => {
      const candidate = item as { endMs?: unknown } | null;
      const endMs = candidate && typeof candidate.endMs === 'number' ? candidate.endMs : 0;
      return Math.max(max, endMs);
    }, 0);
    if (timelineMax > durationMs) throw new Error(`Timeline exceeds encoded media for quiz ${identity.quizId}.`);
    console.log(`quiz=${identity.quizId} artifact=${identity.artifactId} old=${artifact.durationMs ?? 'null'} new=${durationMs} timelineMax=${timelineMax} bytes=${bytes.length}`);
    if (apply && artifact.durationMs !== durationMs) {
      await prisma.listeningAudioArtifact.update({ where: { id: identity.artifactId }, data: { durationMs } });
    }
  }
}

main().finally(() => prisma.$disconnect());
