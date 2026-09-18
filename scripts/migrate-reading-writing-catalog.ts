import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  _Object,
} from '@aws-sdk/client-s3';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ManifestAction =
  | 'KEEP'
  | 'COPY_TO_NEW_KEY'
  | 'UPDATE_DB_REFERENCE'
  | 'ORPHAN_CANDIDATE'
  | 'MISSING_SOURCE_ASSET'
  | 'FRONTEND_LOCAL_ASSET'
  | 'TOEIC_ASSET_EXCLUDED';

export type PracticeModule =
  | 'READING'
  | 'WRITING'
  | 'LISTENING'
  | 'TOEIC'
  | 'MARKET'
  | 'SPEAKING'
  | 'OTHER';

export interface DbReferenceLocation {
  model: string;
  id: number;
  quizId?: number;
  quizTitle?: string;
  quizType?: string;
  module: PracticeModule;
  field: string;
  jsonPath?: string;
  currentUrl: string;
}

export interface ManifestItem {
  oldKey: string | null;
  proposedNewKey: string | null;
  action: ManifestAction;
  mimeType: string;
  size: number;
  module: PracticeModule;
  dbReferences: DbReferenceLocation[];
  reason: string;
  sourceType:
    'R2_OBJECT' | 'DB_REFERENCE' | 'LOCAL_SEED_ASSET' | 'FE_STATIC_ASSET';
  localPath?: string;
}

export interface MigrationReport {
  timestamp: string;
  mode: 'DRY_RUN' | 'APPLY';
  bucket: string;
  publicUrl: string;
  taxonomy: {
    readingImagesPrefix: string;
    readingPassagesPrefix: string;
    readingAttachmentsPrefix: string;
    writingPromptImagesPrefix: string;
    writingReferenceMaterialsPrefix: string;
    writingAttachmentsPrefix: string;
    listeningPracticePrefix: string;
    toeicPrefix: string;
  };
  summary: {
    totalEvaluated: number;
    keep: number;
    copyToNewKey: number;
    updateDbReference: number;
    orphanCandidate: number;
    missingSourceAsset: number;
    frontendLocalAsset: number;
    toeicAssetExcluded: number;
  };
  manifest: ManifestItem[];
  appliedChanges?: {
    objectsCopied: Array<{ from: string; to: string; size: number }>;
    objectsUploaded: Array<{ key: string; size: number }>;
    dbRowsUpdated: Array<{
      model: string;
      id: number;
      field: string;
      previousUrl: string;
      finalUrl: string;
    }>;
  };
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
};

function getMimeType(filePathOrKey: string): string {
  const ext = path.extname(filePathOrKey).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

function normalizeKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!/^https?:\/\//i.test(trimmed)) {
    return /^(catalog|toeic|listening|reading|writing|speaking|market|private|uploads|unclassified)\//.test(
      trimmed,
    )
      ? trimmed.replace(/^\/+/, '')
      : null;
  }

  try {
    const url = new URL(trimmed);
    const publicUrlHost = process.env.R2_PUBLIC_URL
      ? new URL(process.env.R2_PUBLIC_URL).hostname
      : '';
    if (
      !url.hostname.endsWith('.r2.dev') &&
      !url.hostname.endsWith('.r2.cloudflarestorage.com') &&
      url.hostname !== publicUrlHost
    ) {
      return null;
    }
    return decodeURIComponent(url.pathname.replace(/^\/+/, '')) || null;
  } catch {
    return null;
  }
}

async function listAllR2Objects(
  client: S3Client,
  bucket: string,
): Promise<_Object[]> {
  const objects: _Object[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    if (response.Contents) {
      objects.push(...response.Contents);
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return objects;
}

async function scanFrontendPublicFiles(
  frontendPublicDir: string,
): Promise<Array<{ relPath: string; size: number; fullPath: string }>> {
  const results: Array<{ relPath: string; size: number; fullPath: string }> =
    [];
  async function walk(dir: string, prefix = '') {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(full, rel);
        } else {
          const s = await stat(full);
          results.push({ relPath: rel, size: s.size, fullPath: full });
        }
      }
    } catch {
      // ignore if dir doesn't exist
    }
  }
  await walk(frontendPublicDir);
  return results;
}

export async function runMigration(options: { apply?: boolean } = {}) {
  const isApply = Boolean(options.apply);

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || 'breadtrans-files';
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');

  if (!accountId || !accessKeyId || !secretAccessKey || !publicUrl) {
    throw new Error(
      'Safe check failed: Missing required R2 environment variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL). Migration halted safely.',
    );
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const prisma = new PrismaClient();

  try {
    console.log(
      `\n[R2 Catalog Migration] Starting in ${isApply ? 'APPLY (WRITE)' : 'DRY-RUN (READ-ONLY)'} mode...`,
    );
    console.log(`[R2 Catalog Migration] Target Bucket: ${bucket}`);
    console.log(`[R2 Catalog Migration] Public URL: ${publicUrl}\n`);

    // 1. Scan R2
    const r2Objects = await listAllR2Objects(s3, bucket);
    const r2Map = new Map<string, _Object>();
    for (const obj of r2Objects) {
      if (obj.Key) r2Map.set(obj.Key, obj);
    }
    console.log(
      `[R2 Catalog Migration] Found ${r2Objects.length} objects in Cloudflare R2 bucket.`,
    );

    // 2. Scan PostgreSQL for references
    const [
      allQuizzes,
      allQuestions,
      toeicGroups,
      courses,
      lessons,
      materials,
      products,
      submissions,
    ] = await Promise.all([
      prisma.quiz.findMany({
        include: { practiceTopic: true, course: true },
      }),
      prisma.question.findMany({
        include: {
          quiz: {
            include: { practiceTopic: true, course: true },
          },
        },
      }),
      prisma.toeicQuestionGroup.findMany({
        select: { id: true, imageUrl: true, audioUrl: true },
      }),
      prisma.course.findMany({ select: { id: true, thumbnail: true } }),
      prisma.lesson.findMany({ select: { id: true, videoUrl: true } }),
      prisma.material.findMany({ select: { id: true, fileUrl: true } }),
      prisma.marketProduct.findMany({ select: { id: true, imageUrl: true } }),
      prisma.speakingSubmission.findMany({
        select: { id: true, audioKey: true, audioUrl: true },
      }),
    ]);

    console.log(
      `[R2 Catalog Migration] Scanned DB: ${allQuizzes.length} Quizzes, ${allQuestions.length} Questions, ${toeicGroups.length} ToeicQuestionGroups.`,
    );

    // Build database reference map by key
    const dbRefsByKey = new Map<string, DbReferenceLocation[]>();
    const addDbRef = (key: string | null, ref: DbReferenceLocation) => {
      if (!key) return;
      const list = dbRefsByKey.get(key) || [];
      list.push(ref);
      dbRefsByKey.set(key, list);
    };

    for (const group of toeicGroups) {
      if (group.imageUrl) {
        addDbRef(normalizeKey(group.imageUrl), {
          model: 'ToeicQuestionGroup',
          id: group.id,
          module: 'TOEIC',
          field: 'imageUrl',
          currentUrl: group.imageUrl,
        });
      }
      if (group.audioUrl) {
        addDbRef(normalizeKey(group.audioUrl), {
          model: 'ToeicQuestionGroup',
          id: group.id,
          module: 'TOEIC',
          field: 'audioUrl',
          currentUrl: group.audioUrl,
        });
      }
    }

    for (const q of allQuestions) {
      let mod: PracticeModule = 'OTHER';
      if (
        q.quiz.type === 'BILINGUAL_READING' ||
        q.quiz.practiceTopic?.category === 'BILINGUAL_LEVEL'
      ) {
        mod = 'READING';
      } else if (
        q.quiz.type === 'WRITING_PICTURE' ||
        q.quiz.type === 'WRITING_EMAIL' ||
        q.quiz.practiceTopic?.category === 'WRITING_PART1' ||
        q.quiz.practiceTopic?.category === 'WRITING_PART2'
      ) {
        mod = 'WRITING';
      } else if (q.quiz.type === 'LISTENING_PRACTICE') {
        mod = 'LISTENING';
      } else if (
        q.quiz.type === 'TOEIC' ||
        q.quiz.type === 'TOEIC_FOUR_SKILL' ||
        q.quiz.course?.title?.toLowerCase().includes('toeic')
      ) {
        mod = 'TOEIC';
      }

      const content = q.content as Record<string, unknown> | null;
      if (content && typeof content === 'object') {
        const urlKeys = [
          'imageUrl',
          'passageUrl',
          'attachmentUrl',
          'audioUrl',
          'referenceUrl',
        ];
        for (const uKey of urlKeys) {
          const val = content[uKey];
          if (typeof val === 'string' && val.trim()) {
            addDbRef(normalizeKey(val), {
              model: 'Question',
              id: q.id,
              quizId: q.quizId,
              quizTitle: q.quiz.title,
              quizType: q.quiz.type,
              module: mod,
              field: 'content',
              jsonPath: `content.${uKey}`,
              currentUrl: val,
            });
          }
        }
      }
    }

    for (const c of courses) {
      if (c.thumbnail) {
        addDbRef(normalizeKey(c.thumbnail), {
          model: 'Course',
          id: c.id,
          module: 'OTHER',
          field: 'thumbnail',
          currentUrl: c.thumbnail,
        });
      }
    }
    for (const l of lessons) {
      if (l.videoUrl) {
        addDbRef(normalizeKey(l.videoUrl), {
          model: 'Lesson',
          id: l.id,
          module: 'OTHER',
          field: 'videoUrl',
          currentUrl: l.videoUrl,
        });
      }
    }
    for (const m of materials) {
      if (m.fileUrl) {
        addDbRef(normalizeKey(m.fileUrl), {
          model: 'Material',
          id: m.id,
          module: 'OTHER',
          field: 'fileUrl',
          currentUrl: m.fileUrl,
        });
      }
    }
    for (const p of products) {
      if (p.imageUrl) {
        addDbRef(normalizeKey(p.imageUrl), {
          model: 'MarketProduct',
          id: p.id,
          module: 'MARKET',
          field: 'imageUrl',
          currentUrl: p.imageUrl,
        });
      }
    }
    for (const s of submissions) {
      if (s.audioKey) {
        addDbRef(normalizeKey(s.audioKey), {
          model: 'SpeakingSubmission',
          id: s.id,
          module: 'SPEAKING',
          field: 'audioKey',
          currentUrl: s.audioKey,
        });
      }
      if (s.audioUrl) {
        addDbRef(normalizeKey(s.audioUrl), {
          model: 'SpeakingSubmission',
          id: s.id,
          module: 'SPEAKING',
          field: 'audioUrl',
          currentUrl: s.audioUrl,
        });
      }
    }

    // 3. Scan local frontend static assets
    const frontendPublicDir = path.resolve(
      __dirname,
      '..',
      '..',
      'kltn-breadtrans-frontend-junior',
      'public',
    );
    const fePublicFiles = await scanFrontendPublicFiles(frontendPublicDir);
    console.log(
      `[R2 Catalog Migration] Found ${fePublicFiles.length} frontend static assets in public/.`,
    );

    // 4. Build Manifest
    const manifest: ManifestItem[] = [];
    const processedR2Keys = new Set<string>();

    // A. Evaluate every R2 Object
    for (const obj of r2Objects) {
      const key = obj.Key!;
      processedR2Keys.add(key);
      const refs = dbRefsByKey.get(key) || [];
      const size = obj.Size || 0;
      const mime = getMimeType(key);

      // Check if referenced by Reading or Writing
      const hasReadingRef = refs.some((r) => r.module === 'READING');
      const hasWritingRef = refs.some((r) => r.module === 'WRITING');

      // Rule: TOEIC assets stay strictly under catalog/toeic/...
      if (key.startsWith('catalog/toeic/') || key.startsWith('toeic/')) {
        // If also referenced by a general Reading or Writing question:
        if (hasReadingRef || hasWritingRef) {
          const mod = hasWritingRef ? 'WRITING' : 'READING';
          const fileName = path.basename(key);
          const targetKey =
            mod === 'WRITING'
              ? `catalog/writing/practice/prompt-images/${fileName}`
              : `catalog/reading/practice/images/${fileName}`;

          manifest.push({
            oldKey: key,
            proposedNewKey: targetKey,
            action: 'COPY_TO_NEW_KEY',
            mimeType: mime,
            size,
            module: mod,
            dbReferences: refs.filter((r) => r.module === mod),
            reason: `Cross-referenced asset: used by ${mod} practice and TOEIC. Copy to ${targetKey} without moving or deleting TOEIC key.`,
            sourceType: 'R2_OBJECT',
          });

          manifest.push({
            oldKey: key,
            proposedNewKey: key,
            action: 'TOEIC_ASSET_EXCLUDED',
            mimeType: mime,
            size,
            module: 'TOEIC',
            dbReferences: refs.filter((r) => r.module === 'TOEIC'),
            reason:
              'TOEIC exam asset; original key preserved in place under catalog/toeic/.',
            sourceType: 'R2_OBJECT',
          });
        } else {
          manifest.push({
            oldKey: key,
            proposedNewKey: key,
            action: 'TOEIC_ASSET_EXCLUDED',
            mimeType: mime,
            size,
            module: 'TOEIC',
            dbReferences: refs,
            reason:
              'TOEIC exam asset; strictly preserved under catalog/toeic/ taxonomy.',
            sourceType: 'R2_OBJECT',
          });
        }
        continue;
      }

      // Rule: General Listening practice assets standardized
      if (key.startsWith('catalog/listening/practice/')) {
        manifest.push({
          oldKey: key,
          proposedNewKey: key,
          action: 'KEEP',
          mimeType: mime,
          size,
          module: 'LISTENING',
          dbReferences: refs,
          reason:
            'General listening practice asset; already standardized under catalog/listening/practice/images/.',
          sourceType: 'R2_OBJECT',
        });
        continue;
      }

      // Rule: Market products & Speaking submissions
      if (
        key.startsWith('catalog/market/') ||
        key.startsWith('catalog/speaking/')
      ) {
        const mod = key.startsWith('catalog/market/') ? 'MARKET' : 'SPEAKING';
        manifest.push({
          oldKey: key,
          proposedNewKey: key,
          action: 'KEEP',
          mimeType: mime,
          size,
          module: mod,
          dbReferences: refs,
          reason: 'Established catalog domain asset.',
          sourceType: 'R2_OBJECT',
        });
        continue;
      }

      // Rule: Reading assets
      if (key.startsWith('catalog/reading/practice/')) {
        manifest.push({
          oldKey: key,
          proposedNewKey: key,
          action: refs.length > 0 ? 'KEEP' : 'ORPHAN_CANDIDATE',
          mimeType: mime,
          size,
          module: 'READING',
          dbReferences: refs,
          reason:
            refs.length > 0
              ? 'Reading practice asset in target taxonomy.'
              : 'Reading practice asset with no active DB references.',
          sourceType: 'R2_OBJECT',
        });
        continue;
      }

      // Rule: Writing assets
      if (key.startsWith('catalog/writing/practice/')) {
        manifest.push({
          oldKey: key,
          proposedNewKey: key,
          action: refs.length > 0 ? 'KEEP' : 'ORPHAN_CANDIDATE',
          mimeType: mime,
          size,
          module: 'WRITING',
          dbReferences: refs,
          reason:
            refs.length > 0
              ? 'Writing practice asset in target taxonomy.'
              : 'Writing practice asset with no active DB references.',
          sourceType: 'R2_OBJECT',
        });
        continue;
      }

      // Unclassified or legacy objects
      manifest.push({
        oldKey: key,
        proposedNewKey: key,
        action: refs.length > 0 ? 'KEEP' : 'ORPHAN_CANDIDATE',
        mimeType: mime,
        size,
        module: 'OTHER',
        dbReferences: refs,
        reason:
          refs.length > 0
            ? 'Legacy/unclassified key retained due to active DB reference.'
            : 'Unreferenced legacy object; candidate for retention or future cleanup.',
        sourceType: 'R2_OBJECT',
      });
    }

    // B. Check DB references that might point to missing R2 objects or need cross-module migration
    for (const [key, refs] of dbRefsByKey.entries()) {
      const existsInR2 = r2Map.has(key);

      // Check if any reference is a General Reading or Writing practice reference pointing to an old or TOEIC key
      for (const ref of refs) {
        if (ref.module === 'READING' || ref.module === 'WRITING') {
          const mod = ref.module;
          const isTargetTaxonomy =
            key.startsWith('catalog/reading/practice/') ||
            key.startsWith('catalog/writing/practice/');

          if (!isTargetTaxonomy) {
            const fileName = path.basename(key);
            const targetKey =
              mod === 'WRITING'
                ? `catalog/writing/practice/prompt-images/${fileName}`
                : `catalog/reading/practice/images/${fileName}`;

            if (existsInR2) {
              if (
                !manifest.some(
                  (m) => m.oldKey === key && m.proposedNewKey === targetKey,
                )
              ) {
                manifest.push({
                  oldKey: key,
                  proposedNewKey: targetKey,
                  action: 'COPY_TO_NEW_KEY',
                  mimeType: getMimeType(fileName),
                  size: r2Map.get(key)?.Size || 0,
                  module: mod,
                  dbReferences: [ref],
                  reason: `General ${mod} practice referencing non-catalog/TOEIC asset; copy to target taxonomy and update DB reference.`,
                  sourceType: 'DB_REFERENCE',
                });
              }
            } else {
              if (!manifest.some((m) => m.oldKey === key)) {
                manifest.push({
                  oldKey: key,
                  proposedNewKey: targetKey,
                  action: 'MISSING_SOURCE_ASSET',
                  mimeType: getMimeType(fileName),
                  size: 0,
                  module: mod,
                  dbReferences: [ref],
                  reason: `Referenced by DB but missing from R2 bucket.`,
                  sourceType: 'DB_REFERENCE',
                });
              }
            }
          }
        }
      }

      if (!existsInR2 && !manifest.some((m) => m.oldKey === key)) {
        manifest.push({
          oldKey: key,
          proposedNewKey: key,
          action: 'MISSING_SOURCE_ASSET',
          mimeType: getMimeType(key),
          size: 0,
          module: refs[0]?.module || 'OTHER',
          dbReferences: refs,
          reason: 'Referenced by database but does not exist in R2 bucket.',
          sourceType: 'DB_REFERENCE',
        });
      }
    }

    // C. Add Frontend Local Static Assets
    for (const feFile of fePublicFiles) {
      manifest.push({
        oldKey: null,
        proposedNewKey: null,
        action: 'FRONTEND_LOCAL_ASSET',
        mimeType: getMimeType(feFile.relPath),
        size: feFile.size,
        module: 'OTHER',
        dbReferences: [],
        reason: `Frontend local static file in public/${feFile.relPath}`,
        sourceType: 'FE_STATIC_ASSET',
        localPath: feFile.fullPath,
      });
    }

    // 5. Summarize Manifest
    const counts = {
      totalEvaluated: manifest.length,
      keep: manifest.filter((m) => m.action === 'KEEP').length,
      copyToNewKey: manifest.filter((m) => m.action === 'COPY_TO_NEW_KEY')
        .length,
      updateDbReference: manifest.filter(
        (m) => m.action === 'UPDATE_DB_REFERENCE',
      ).length,
      orphanCandidate: manifest.filter((m) => m.action === 'ORPHAN_CANDIDATE')
        .length,
      missingSourceAsset: manifest.filter(
        (m) => m.action === 'MISSING_SOURCE_ASSET',
      ).length,
      frontendLocalAsset: manifest.filter(
        (m) => m.action === 'FRONTEND_LOCAL_ASSET',
      ).length,
      toeicAssetExcluded: manifest.filter(
        (m) => m.action === 'TOEIC_ASSET_EXCLUDED',
      ).length,
    };

    console.log('=== R2 TAXONOMY MANIFEST CLASSIFICATION COUNTS ===');
    console.table(counts);

    // 6. Apply Execution if --apply is requested
    const appliedChanges: MigrationReport['appliedChanges'] = {
      objectsCopied: [],
      objectsUploaded: [],
      dbRowsUpdated: [],
    };

    if (isApply) {
      console.log(
        '\n[R2 Catalog Migration] Executing migration actions (--apply enabled)...',
      );

      // Process COPY_TO_NEW_KEY actions
      const copyActions = manifest.filter(
        (m) => m.action === 'COPY_TO_NEW_KEY' && m.oldKey && m.proposedNewKey,
      );
      for (const item of copyActions) {
        const oldKey = item.oldKey!;
        const newKey = item.proposedNewKey!;

        // Idempotency: check if destination already exists with same size
        let skipCopy = false;
        try {
          const destHead = await s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: newKey }),
          );
          if (destHead.ContentLength === item.size) {
            console.log(
              `[IDEMPOTENT] ${newKey} already exists with identical size (${item.size} bytes). Skipping copy.`,
            );
            skipCopy = true;
          }
        } catch {
          // Object doesn't exist yet, proceed with copy
        }

        if (!skipCopy) {
          console.log(`[COPY] Copying R2 object: ${oldKey} -> ${newKey}`);
          await s3.send(
            new CopyObjectCommand({
              Bucket: bucket,
              Key: newKey,
              CopySource: `${bucket}/${encodeURIComponent(oldKey).replace(/%2F/g, '/')}`,
              MetadataDirective: 'REPLACE',
              ContentType: item.mimeType,
              CacheControl: 'public, max-age=31536000, immutable',
            }),
          );

          // Verify with HeadObject
          const verified = await s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: newKey }),
          );
          if (verified.ContentLength !== item.size) {
            throw new Error(
              `Verification error: Size mismatch after copy for ${newKey}`,
            );
          }
          appliedChanges.objectsCopied.push({
            from: oldKey,
            to: newKey,
            size: item.size,
          });
        }

        // Update DB references in a transaction
        const targetUrl = `${publicUrl}/${newKey}`;
        for (const ref of item.dbReferences) {
          if (ref.model === 'Question' && ref.jsonPath) {
            await prisma.$transaction(async (tx) => {
              const qRow = await tx.question.findUnique({
                where: { id: ref.id },
              });
              if (!qRow) return;
              const content = (qRow.content as Record<string, unknown>) || {};
              const propName = ref.jsonPath!.split('.')[1];
              const prevVal = content[propName];

              content[propName] = targetUrl;
              await tx.question.update({
                where: { id: ref.id },
                data: { content: content as any },
              });

              appliedChanges.dbRowsUpdated.push({
                model: 'Question',
                id: ref.id,
                field: ref.jsonPath!,
                previousUrl: String(prevVal),
                finalUrl: targetUrl,
              });
            });
          }
        }
      }

      console.log(`[R2 Catalog Migration] Apply completed successfully.`);
      console.log(`  Objects Copied: ${appliedChanges.objectsCopied.length}`);
      console.log(
        `  Database Rows Updated: ${appliedChanges.dbRowsUpdated.length}`,
      );
    } else {
      console.log(
        '\n[DRY RUN ONLY] No objects were copied, modified, or deleted. No database records were altered.',
      );
      console.log(
        'To execute the changes, run with: npx ts-node -r dotenv/config scripts/migrate-reading-writing-catalog.ts --apply\n',
      );
    }

    const report: MigrationReport = {
      timestamp: new Date().toISOString(),
      mode: isApply ? 'APPLY' : 'DRY_RUN',
      bucket,
      publicUrl,
      taxonomy: {
        readingImagesPrefix: 'catalog/reading/practice/images/',
        readingPassagesPrefix: 'catalog/reading/practice/passages/',
        readingAttachmentsPrefix: 'catalog/reading/practice/attachments/',
        writingPromptImagesPrefix: 'catalog/writing/practice/prompt-images/',
        writingReferenceMaterialsPrefix:
          'catalog/writing/practice/reference-materials/',
        writingAttachmentsPrefix: 'catalog/writing/practice/attachments/',
        listeningPracticePrefix: 'catalog/listening/practice/images/',
        toeicPrefix: 'catalog/toeic/',
      },
      summary: counts,
      manifest,
      appliedChanges: isApply ? appliedChanges : undefined,
    };

    const outDir = path.resolve(__dirname, '..', '..', 'docs');
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(
      outDir,
      'r2_reading_writing_migration_manifest.json',
    );
    await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[Report Saved] Manifest written to ${outPath}`);

    return report;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const isApply = process.argv.includes('--apply');
  runMigration({ apply: isApply }).catch((err) => {
    console.error('[FATAL ERROR]', err);
    process.exit(1);
  });
}
