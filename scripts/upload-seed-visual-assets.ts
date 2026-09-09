import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');

if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicUrl) {
  throw new Error('R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_PUBLIC_URL are required.');
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const assets = [
  'folders-cabinet.png',
  'construction-plan.png',
  'bicycle-rack.png',
  'restaurant-service.png',
  'ceiling-light.png',
  'departure-board.png',
  'cafe-counter.png',
  'office-meeting.png',
  'delivery-boxes.png',
  'grocery-checkout.png',
];

const root = path.resolve(__dirname, '..', 'prisma', 'seed-assets');

async function main(): Promise<void> {
  for (const name of assets) {
    const body = await readFile(path.join(root, name));
    const key = `toeic/visuals/${name}`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'image/png',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    console.log(`${name}: ${publicUrl}/${key}`);
  }
}

void main();
