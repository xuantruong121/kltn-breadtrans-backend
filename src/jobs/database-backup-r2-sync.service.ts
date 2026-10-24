import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { basename, join, dirname } from 'path';

export interface SyncResult {
  synced: string[];
  skipped: string[];
  failed: Array<{ file: string; error: string }>;
  pruned: string[];
}

interface BackupCatalogEntry {
  id: string;
  class: string;
  checkpoint: string;
  createdAt: string;
  database: string;
  fullLogicalBackup: boolean;
  mediaBytesIncluded: boolean;
  dumpFile: string;
  globalsFile?: string;
  metadataFile?: string;
  localPath: string;
  bytes: number;
  sha256: string;
  postgresVersion?: string;
  migrationCount?: number;
  gitCommit?: string;
  format: string;
  archiveVerified: boolean;
  protected: boolean;
  r2RemoteKey?: string;
  r2UploadVerified?: boolean;
  r2Bucket?: string;
  r2RemoteSha256?: string;
  r2PublicProbeStatus?: number;
  r2SyncedAt?: string;
}

interface BackupCatalog {
  schemaVersion: number;
  updatedAt: string;
  backups: BackupCatalogEntry[];
}

@Injectable()
export class DatabaseBackupR2SyncService {
  private readonly logger = new Logger(DatabaseBackupR2SyncService.name);

  getClient(): S3Client | null {
    const bucket = process.env.R2_BACKUP_BUCKET_NAME;
    const endpoint = process.env.R2_BACKUP_ENDPOINT;
    const accessKeyId = process.env.R2_BACKUP_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_BACKUP_SECRET_ACCESS_KEY;

    if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
      return null;
    }

    if (bucket === process.env.R2_BUCKET_NAME) {
      this.logger.error(
        'REFUSING R2 BACKUP: R2_BACKUP_BUCKET_NAME equals public R2_BUCKET_NAME. Database dumps must never go to public media bucket.',
      );
      return null;
    }

    try {
      const endpointUrl = new URL(endpoint);
      if (endpointUrl.pathname.replace(/\//g, '').length > 0) {
        this.logger.error(
          `REFUSING R2 BACKUP: R2_BACKUP_ENDPOINT must be account root, got pathname "${endpointUrl.pathname}".`,
        );
        return null;
      }
    } catch {
      this.logger.error(
        'REFUSING R2 BACKUP: R2_BACKUP_ENDPOINT is not a valid URL.',
      );
      return null;
    }

    return new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  getBackupDirs(): string[] {
    const dirs: string[] = [];
    if (
      process.env.POSTGRES_BACKUP_DIR &&
      existsSync(process.env.POSTGRES_BACKUP_DIR)
    ) {
      dirs.push(process.env.POSTGRES_BACKUP_DIR);
    }

    const defaultAuto = 'D:/Study/KLTN/.local-backups/breadtrans-auto';
    if (existsSync(defaultAuto) && !dirs.includes(defaultAuto)) {
      dirs.push(defaultAuto);
    }

    const defaultCanonical = 'D:/Study/KLTN/.local-backups/breadtrans';
    if (existsSync(defaultCanonical) && !dirs.includes(defaultCanonical)) {
      dirs.push(defaultCanonical);
    }

    const localRelative = join(process.cwd(), 'db-backups');
    if (existsSync(localRelative) && !dirs.includes(localRelative)) {
      dirs.push(localRelative);
    }

    return dirs;
  }

  getCatalogPath(): string {
    const canonicalCatalog =
      'D:/Study/KLTN/.local-backups/breadtrans/catalog/backup-catalog.json';
    if (existsSync(dirname(canonicalCatalog))) {
      return canonicalCatalog;
    }
    const fallbackDir =
      process.env.POSTGRES_BACKUP_DIR || join(process.cwd(), 'db-backups');
    return join(fallbackDir, 'backup-catalog.json');
  }

  readCatalog(catalogPath: string): BackupCatalog {
    if (existsSync(catalogPath)) {
      try {
        const raw = readFileSync(catalogPath, 'utf8');
        return JSON.parse(raw) as BackupCatalog;
      } catch (err) {
        this.logger.warn(
          `Could not parse catalog at ${catalogPath}: ${(err as Error).message}`,
        );
      }
    }
    return {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      backups: [],
    };
  }

  writeCatalog(catalogPath: string, catalog: BackupCatalog): void {
    try {
      mkdirSync(dirname(catalogPath), { recursive: true });
      catalog.updatedAt = new Date().toISOString();
      const tmpPath = `${catalogPath}.tmp.${Date.now()}`;
      writeFileSync(tmpPath, JSON.stringify(catalog, null, 2), 'utf8');
      writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
      if (existsSync(tmpPath)) {
        try {
          unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to update backup catalog at ${catalogPath}: ${(err as Error).message}`,
      );
    }
  }

  classifyDump(fileName: string): {
    backupClass: string;
    checkpoint: string;
    isProtected: boolean;
  } {
    const upper = fileName.toUpperCase();
    const isProtected = upper.includes('PROTECTED');

    let backupClass = 'AUTOMATIC';
    let checkpoint = 'scheduled';

    if (isProtected) {
      if (upper.includes('BASELINE') || upper.includes('CANONICAL')) {
        backupClass = 'PROTECTED_BASELINE';
        checkpoint = 'baseline';
      } else if (upper.includes('HANDOFF')) {
        backupClass = 'PROTECTED_HANDOFF';
        checkpoint = 'handoff';
      } else if (upper.includes('PRE_RECOVERY') || upper.includes('RECOVERY')) {
        backupClass = 'PROTECTED_PRE_RECOVERY';
        checkpoint = 'pre-recovery';
      } else {
        backupClass = 'PROTECTED_BASELINE';
        checkpoint = 'protected-checkpoint';
      }
    }

    return { backupClass, checkpoint, isProtected };
  }

  computeRemoteKey(
    fileName: string,
    backupClass: string,
    checkpoint: string,
    fileDate = new Date(),
  ): string {
    if (backupClass === 'AUTOMATIC') {
      const y = fileDate.getUTCFullYear();
      const m = String(fileDate.getUTCMonth() + 1).padStart(2, '0');
      const d = String(fileDate.getUTCDate()).padStart(2, '0');
      return `database-backups/automatic/${y}/${m}/${d}/${basename(fileName)}`;
    }

    const subDir =
      backupClass === 'PROTECTED_PRE_RECOVERY'
        ? `protected/pre-recovery/${checkpoint}`
        : backupClass === 'PROTECTED_HANDOFF'
          ? `protected/handoff/${checkpoint}`
          : `protected/baseline/${checkpoint}`;

    return `database-backups/${subDir}/${basename(fileName)}`;
  }

  calculateSha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async syncPendingBackups(options?: {
    retentionDays?: number;
  }): Promise<SyncResult> {
    const result: SyncResult = {
      synced: [],
      skipped: [],
      failed: [],
      pruned: [],
    };

    const client = this.getClient();
    if (!client) {
      this.logger.warn(
        'R2 backup is skipped: credentials or bucket not configured or invalid.',
      );
      return result;
    }

    const bucket = process.env.R2_BACKUP_BUCKET_NAME!;
    const publicBase = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
    const catalogPath = this.getCatalogPath();
    const catalog = this.readCatalog(catalogPath);
    const backupDirs = this.getBackupDirs();

    this.logger.log(
      `Starting automated R2 backup sync across dirs: ${backupDirs.join(', ')}`,
    );

    for (const dir of backupDirs) {
      let files: string[] = [];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.dump'));
      } catch (err) {
        this.logger.warn(
          `Could not read directory ${dir}: ${(err as Error).message}`,
        );
        continue;
      }

      for (const file of files) {
        const fullPath = join(dir, file);
        try {
          const stat = statSync(fullPath);
          if (stat.size <= 0) {
            result.skipped.push(`${file} (0 bytes)`);
            continue;
          }

          const existingEntry = catalog.backups.find(
            (b) =>
              b.dumpFile === file &&
              b.r2UploadVerified === true &&
              b.bytes === stat.size,
          );

          if (existingEntry && existingEntry.r2RemoteKey) {
            // Already verified in catalog, verify object exists on remote
            try {
              await client.send(
                new HeadObjectCommand({
                  Bucket: bucket,
                  Key: existingEntry.r2RemoteKey,
                }),
              );
              result.skipped.push(`${file} (already in R2)`);
              continue;
            } catch {
              // Remote object missing, re-upload
              this.logger.log(
                `Remote object ${existingEntry.r2RemoteKey} not found in R2, re-syncing.`,
              );
            }
          }

          this.logger.log(
            `Syncing backup to R2: ${file} (${stat.size} bytes)...`,
          );
          const fileBytes = readFileSync(fullPath);
          const localSha = this.calculateSha256(fileBytes);
          const { backupClass, checkpoint, isProtected } =
            this.classifyDump(file);
          const remoteKey = this.computeRemoteKey(
            file,
            backupClass,
            checkpoint,
            stat.mtime,
          );

          // 1. Upload
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: remoteKey,
              Body: fileBytes,
              ContentType: 'application/octet-stream',
              Metadata: {
                checkpoint,
                class: backupClass,
                sha256: localSha,
                database: 'kltn_db',
              },
            }),
          );

          // 2. HeadObject verification
          const head = await client.send(
            new HeadObjectCommand({ Bucket: bucket, Key: remoteKey }),
          );
          if (head.ContentLength !== stat.size) {
            throw new Error(
              `Remote size mismatch: expected ${stat.size}, got ${head.ContentLength}`,
            );
          }

          // 3. Round-trip download verification
          const getObj = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: remoteKey }),
          );
          const downloadedBytes = Buffer.from(
            await getObj.Body!.transformToByteArray(),
          );
          const downloadedSha = this.calculateSha256(downloadedBytes);
          if (downloadedSha !== localSha) {
            throw new Error(
              `Remote SHA-256 mismatch: local=${localSha}, downloaded=${downloadedSha}`,
            );
          }

          // 4. Privacy probe
          let probeStatus = 404;
          if (publicBase) {
            try {
              const probeRes = await fetch(`${publicBase}/${remoteKey}`, {
                method: 'GET',
              });
              probeStatus = probeRes.status;
              if (probeRes.ok) {
                throw new Error(
                  'SECURITY VIOLATION: Uploaded database dump is publicly accessible via R2_PUBLIC_URL',
                );
              }
            } catch (probeErr: any) {
              if (probeErr.message.includes('SECURITY VIOLATION'))
                throw probeErr;
              // Network error reaching public URL means not publicly accessible
              probeStatus = 0;
            }
          }

          // 5. Update catalog
          let entry = catalog.backups.find((b) => b.dumpFile === file);
          if (!entry) {
            entry = {
              id: `${checkpoint}_${file.replace(/\.dump$/, '')}`,
              class: backupClass,
              checkpoint,
              createdAt: stat.mtime.toISOString(),
              database: 'kltn_db',
              fullLogicalBackup: true,
              mediaBytesIncluded: false,
              dumpFile: file,
              localPath: fullPath,
              bytes: stat.size,
              sha256: localSha,
              format: 'custom (pg_dump -Fc)',
              archiveVerified: true,
              protected: isProtected,
            };
            catalog.backups.push(entry);
          }

          entry.r2RemoteKey = remoteKey;
          entry.r2UploadVerified = true;
          entry.r2Bucket = bucket;
          entry.r2RemoteSha256 = downloadedSha;
          entry.r2PublicProbeStatus = probeStatus;
          entry.r2SyncedAt = new Date().toISOString();

          this.writeCatalog(catalogPath, catalog);
          result.synced.push(file);
          this.logger.log(`SUCCESS: Synced ${file} to R2 (${remoteKey})`);
        } catch (err: any) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`FAILED syncing ${file} to R2: ${msg}`);
          result.failed.push({ file, error: msg });
        }
      }
    }

    // 6. Prune remote automatic backups older than retentionDays
    const retentionDays = options?.retentionDays ?? 14;
    try {
      const pruned = await this.pruneRemoteAutomaticBackups(
        client,
        bucket,
        retentionDays,
      );
      result.pruned.push(...pruned);
    } catch (pruneErr) {
      this.logger.warn(
        `Remote backup retention pruning failed: ${(pruneErr as Error).message}`,
      );
    }

    this.logger.log(
      `Automated R2 backup sync complete. Synced: ${result.synced.length}, Skipped: ${result.skipped.length}, Failed: ${result.failed.length}, Pruned: ${result.pruned.length}`,
    );

    return result;
  }

  async pruneRemoteAutomaticBackups(
    client: S3Client,
    bucket: string,
    retentionDays: number,
  ): Promise<string[]> {
    const pruned: string[] = [];
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: 'database-backups/automatic/',
          ContinuationToken: continuationToken,
        }),
      );

      const contents = list.Contents ?? [];
      for (const obj of contents) {
        if (!obj.Key || !obj.LastModified) continue;
        // Never prune protected objects
        if (obj.Key.includes('PROTECTED') || obj.Key.includes('protected'))
          continue;

        if (obj.LastModified.getTime() < cutoffTime) {
          await client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: obj.Key,
            }),
          );
          pruned.push(obj.Key);
          this.logger.log(
            `Pruned expired automatic backup from R2: ${obj.Key}`,
          );
        }
      }

      continuationToken = list.NextContinuationToken;
    } while (continuationToken);

    return pruned;
  }
}
