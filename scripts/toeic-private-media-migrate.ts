/**
 * Move a TOEIC exam's Listening audio (group clips + master) to the private
 * bucket (P05). Copy first, convert the rows second; the public objects are
 * deleted later, by the owner, after verification.
 *
 *   plan     read-only: list sources and private targets, write the manifest
 *   copy     source -> private bucket, sha256 checked after write
 *            (needs TOEIC_PRIVATE_MEDIA_AUTHORIZED=copy)
 *   convert  one transaction: each row's audioUrl -> private key, previous URL
 *            and key kept in mediaMetadata.audio; writes a rollback SQL first
 *            (needs TOEIC_PRIVATE_MEDIA_AUTHORIZED=convert)
 *   verify   read-only: rows hold the keys, private objects match the manifest
 *
 * Every mode needs TOEIC_PRIVATE_MEDIA_EXPECT_DB_SYSID equal to the target
 * database's system_identifier, so the run cannot land on another database.
 * Storage settings come from the usual R2_* / LOCAL_S3_* variables; nothing
 * secret is printed.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-private-media-migrate.ts <mode> [examId] [--manifest file]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  listeningMasterFor,
  privateListeningMasterKey,
} from '../src/modules/toeic/toeic-listening-master';
import {
  isPrivateListeningMediaKey,
  R2Service,
} from '../src/modules/upload/r2.service';

type Item = {
  kind: 'clip' | 'master';
  groupId?: number;
  sourceUrl?: string;
  sourceKey: string;
  sourceFile?: string;
  privateKey: string;
  sha256?: string;
  bytes?: number;
};

type Manifest = { examId: number; dbSystemIdentifier: string; items: Item[] };

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function args() {
  const [mode = 'plan', ...rest] = process.argv.slice(2);
  const manifestAt = rest.indexOf('--manifest');
  const examId = Number(rest.find((a) => /^\d+$/.test(a)) ?? 1);
  const manifest =
    manifestAt >= 0
      ? rest[manifestAt + 1]
      : join(
          'artifacts',
          'toeic-private-media',
          `manifest-exam-${examId}.json`,
        );
  if (!['plan', 'copy', 'convert', 'verify'].includes(mode))
    throw new Error(`unknown mode ${mode}`);
  return { mode, examId, manifest };
}

async function guardDatabase(prisma: PrismaClient): Promise<string> {
  const expected = process.env.TOEIC_PRIVATE_MEDIA_EXPECT_DB_SYSID?.trim();
  const [{ system_identifier }] = await prisma.$queryRaw<
    Array<{ system_identifier: string }>
  >`SELECT system_identifier::text FROM pg_control_system()`;
  if (!expected || expected !== system_identifier)
    throw new Error(
      `REFUSED: TOEIC_PRIVATE_MEDIA_EXPECT_DB_SYSID must equal the target database (${system_identifier})`,
    );
  return system_identifier;
}

function requireAuthorized(mode: string) {
  if (process.env.TOEIC_PRIVATE_MEDIA_AUTHORIZED !== mode)
    throw new Error(`REFUSED: TOEIC_PRIVATE_MEDIA_AUTHORIZED=${mode} not set`);
}

async function plan(
  prisma: PrismaClient,
  examId: number,
  sysid: string,
): Promise<Manifest> {
  const groups = await prisma.toeicQuestionGroup.findMany({
    where: { examId, audioUrl: { not: null } },
    select: { id: true, audioUrl: true, mediaMetadata: true },
    orderBy: { id: 'asc' },
  });
  const items: Item[] = [];
  for (const g of groups) {
    const url = g.audioUrl!;
    if (isPrivateListeningMediaKey(url)) continue; // already migrated
    const key = (g.mediaMetadata as any)?.audio?.r2Key as string | undefined;
    if (!key || !url.endsWith(`/${key}`))
      throw new Error(
        `group ${g.id}: audioUrl does not end with mediaMetadata.audio.r2Key`,
      );
    items.push({
      kind: 'clip',
      groupId: g.id,
      sourceUrl: url,
      sourceKey: key,
      privateKey: `premium/listening/${key}`,
    });
  }
  const master = listeningMasterFor(examId);
  if (master) {
    const file = join(
      'artifacts',
      'toeic-listening-master',
      `exam-${examId}`,
      'master.mp3',
    );
    items.push({
      kind: 'master',
      sourceKey: master.key,
      sourceFile:
        existsSync(file) && sha256(readFileSync(file)) === master.sha256
          ? file
          : undefined,
      privateKey: privateListeningMasterKey(master),
      sha256: master.sha256,
      bytes: master.bytes,
    });
  }
  return { examId, dbSystemIdentifier: sysid, items };
}

async function copy(r2: R2Service, manifest: Manifest) {
  for (const item of manifest.items) {
    const source = item.sourceFile
      ? readFileSync(item.sourceFile)
      : await r2.downloadFileBuffer(item.sourceKey);
    const hash = sha256(source);
    if (item.kind === 'master' && hash !== item.sha256)
      throw new Error('master: source sha256 differs from the registry');
    if (await r2.privateObjectExists(item.privateKey)) {
      const existing = sha256(
        await r2.downloadPrivateFileBuffer(item.privateKey),
      );
      if (existing !== hash)
        throw new Error(
          `${item.privateKey}: a different private object already exists`,
        );
    } else {
      await r2.putPrivateObjectAtKey(item.privateKey, source, 'audio/mpeg');
      const written = sha256(
        await r2.downloadPrivateFileBuffer(item.privateKey),
      );
      if (written !== hash)
        throw new Error(`${item.privateKey}: sha256 mismatch after write`);
    }
    item.sha256 = hash;
    item.bytes = source.length;
  }
}

const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function convert(
  prisma: PrismaClient,
  manifest: Manifest,
  manifestPath: string,
) {
  const clips = manifest.items.filter((i) => i.kind === 'clip');
  if (clips.some((c) => !c.sha256))
    throw new Error(
      'REFUSED: run copy first (manifest has clips without sha256)',
    );
  const rows = await prisma.toeicQuestionGroup.findMany({
    where: { id: { in: clips.map((c) => c.groupId!) } },
    select: { id: true, audioUrl: true, mediaMetadata: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rollback = [
    '-- Rollback of convert for TOEIC exam ' +
      manifest.examId +
      ' (restores audioUrl and mediaMetadata).',
    'BEGIN;',
    ...clips.map((c) => {
      const row = byId.get(c.groupId!)!;
      return `UPDATE "ToeicQuestionGroup" SET "audioUrl" = ${sqlText(row.audioUrl!)}, "mediaMetadata" = ${sqlText(JSON.stringify(row.mediaMetadata))}::jsonb WHERE id = ${c.groupId} AND "audioUrl" = ${sqlText(c.privateKey)};`;
    }),
    'COMMIT;',
  ].join('\n');
  const rollbackPath = manifestPath.replace(/\.json$/, '') + '.rollback.sql';
  writeFileSync(rollbackPath, rollback + '\n');
  console.log(`rollback written: ${rollbackPath}`);
  await prisma.$transaction(async (tx) => {
    let changed = 0;
    for (const c of clips) {
      const row = byId.get(c.groupId!);
      if (!row || row.audioUrl !== c.sourceUrl)
        throw new Error(`group ${c.groupId}: row changed since plan`);
      const audio = { ...((row.mediaMetadata as any)?.audio ?? {}) };
      const metadata = {
        ...((row.mediaMetadata as any) ?? {}),
        audio: {
          ...audio,
          r2Key: c.privateKey,
          publicR2KeyBefore: c.sourceKey,
          publicUrlBefore: c.sourceUrl,
        },
      };
      changed += await tx.$executeRaw`
        UPDATE "ToeicQuestionGroup"
        SET "audioUrl" = ${c.privateKey}, "mediaMetadata" = ${JSON.stringify(metadata)}::jsonb
        WHERE id = ${c.groupId} AND "audioUrl" = ${c.sourceUrl}`;
    }
    if (changed !== clips.length)
      throw new Error(
        `expected ${clips.length} rows, changed ${changed}; rolled back`,
      );
  });
  console.log(`converted ${clips.length} rows`);
}

async function verify(prisma: PrismaClient, r2: R2Service, manifest: Manifest) {
  let failures = 0;
  for (const item of manifest.items) {
    if (item.kind === 'clip') {
      const row = await prisma.toeicQuestionGroup.findUnique({
        where: { id: item.groupId! },
        select: { audioUrl: true },
      });
      if (row?.audioUrl !== item.privateKey) {
        failures += 1;
        console.log(`FAIL row ${item.groupId} does not hold its private key`);
      }
    }
    const ok =
      (await r2.privateObjectExists(item.privateKey)) &&
      sha256(await r2.downloadPrivateFileBuffer(item.privateKey)) ===
        item.sha256;
    if (!ok) {
      failures += 1;
      console.log(`FAIL private object ${item.privateKey}`);
    }
  }
  console.log(`TOEIC_PRIVATE_MEDIA_VERIFY_FAILURES=${failures}`);
  return failures;
}

async function main() {
  const { mode, examId, manifest: manifestPath } = args();
  const prisma = new PrismaClient();
  try {
    const sysid = await guardDatabase(prisma);
    const r2 = new R2Service();
    if (mode === 'plan') {
      const manifest = await plan(prisma, examId, sysid);
      mkdirSync(dirname(manifestPath), { recursive: true });
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      const clips = manifest.items.filter((i) => i.kind === 'clip').length;
      const master = manifest.items.find((i) => i.kind === 'master');
      console.log(
        `plan: exam ${examId}, ${clips} clips, master ${master ? (master.sourceFile ? 'from verified local file' : 'from public object') : 'none'}; manifest ${manifestPath}`,
      );
      return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    if (manifest.dbSystemIdentifier !== sysid || manifest.examId !== examId)
      throw new Error(
        'REFUSED: manifest was planned for another database or exam',
      );
    if (mode === 'copy') {
      requireAuthorized('copy');
      await copy(r2, manifest);
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      console.log(`copied/verified ${manifest.items.length} objects`);
    } else if (mode === 'convert') {
      requireAuthorized('convert');
      await convert(prisma, manifest, manifestPath);
    } else {
      process.exitCode = (await verify(prisma, r2, manifest)) ? 1 : 0;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
