import { DatabaseBackupR2SyncService } from './database-backup-r2-sync.service';

describe('DatabaseBackupR2SyncService', () => {
  let service: DatabaseBackupR2SyncService;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    service = new DatabaseBackupR2SyncService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getClient validation', () => {
    it('returns null if any R2_BACKUP credential is missing', () => {
      delete process.env.R2_BACKUP_BUCKET_NAME;
      expect(service.getClient()).toBeNull();
    });

    it('returns null and rejects if backup bucket equals public media bucket', () => {
      process.env.R2_BACKUP_BUCKET_NAME = 'same-bucket';
      process.env.R2_BUCKET_NAME = 'same-bucket';
      process.env.R2_BACKUP_ENDPOINT = 'https://account.r2.cloudflarestorage.com';
      process.env.R2_BACKUP_ACCESS_KEY_ID = 'key';
      process.env.R2_BACKUP_SECRET_ACCESS_KEY = 'secret';

      expect(service.getClient()).toBeNull();
    });

    it('returns null if R2_BACKUP_ENDPOINT contains a bucket pathname', () => {
      process.env.R2_BACKUP_BUCKET_NAME = 'backup-bucket';
      process.env.R2_BUCKET_NAME = 'media-bucket';
      process.env.R2_BACKUP_ENDPOINT = 'https://account.r2.cloudflarestorage.com/backup-bucket';
      process.env.R2_BACKUP_ACCESS_KEY_ID = 'key';
      process.env.R2_BACKUP_SECRET_ACCESS_KEY = 'secret';

      expect(service.getClient()).toBeNull();
    });

    it('instantiates S3Client when configuration is valid root endpoint', () => {
      process.env.R2_BACKUP_BUCKET_NAME = 'backup-bucket';
      process.env.R2_BUCKET_NAME = 'media-bucket';
      process.env.R2_BACKUP_ENDPOINT = 'https://account.r2.cloudflarestorage.com';
      process.env.R2_BACKUP_ACCESS_KEY_ID = 'key';
      process.env.R2_BACKUP_SECRET_ACCESS_KEY = 'secret';

      const client = service.getClient();
      expect(client).not.toBeNull();
    });
  });

  describe('classifyDump', () => {
    it('classifies normal timestamped dump as AUTOMATIC', () => {
      const { backupClass, checkpoint, isProtected } = service.classifyDump('kltn_db_20261023_133044.dump');
      expect(backupClass).toBe('AUTOMATIC');
      expect(checkpoint).toBe('scheduled');
      expect(isProtected).toBe(false);
    });

    it('classifies CANONICAL_BASELINE_PROTECTED dump as PROTECTED_BASELINE', () => {
      const { backupClass, checkpoint, isProtected } = service.classifyDump(
        'kltn_db_CANONICAL_BASELINE_PROTECTED_20261023_080526.dump',
      );
      expect(backupClass).toBe('PROTECTED_BASELINE');
      expect(checkpoint).toBe('baseline');
      expect(isProtected).toBe(true);
    });

    it('classifies CLAUDE_HANDOFF_PROTECTED dump as PROTECTED_HANDOFF', () => {
      const { backupClass, checkpoint, isProtected } = service.classifyDump(
        'kltn_db_CLAUDE_HANDOFF_PROTECTED_20261023_080201.dump',
      );
      expect(backupClass).toBe('PROTECTED_HANDOFF');
      expect(checkpoint).toBe('handoff');
      expect(isProtected).toBe(true);
    });

    it('classifies PRE_LEARNER_RECOVERY_PROTECTED dump as PROTECTED_PRE_RECOVERY', () => {
      const { backupClass, checkpoint, isProtected } = service.classifyDump(
        'kltn_db_PRE_LEARNER_RECOVERY_PROTECTED_20261023_081232.dump',
      );
      expect(backupClass).toBe('PROTECTED_PRE_RECOVERY');
      expect(checkpoint).toBe('pre-recovery');
      expect(isProtected).toBe(true);
    });
  });

  describe('computeRemoteKey', () => {
    it('creates automatic path with YYYY/MM/DD prefix', () => {
      const date = new Date(Date.UTC(2026, 9, 23, 12, 0, 0)); // Oct 23, 2026
      const key = service.computeRemoteKey('kltn_db_20261023_133044.dump', 'AUTOMATIC', 'scheduled', date);
      expect(key).toBe('database-backups/automatic/2026/10/23/kltn_db_20261023_133044.dump');
    });

    it('creates protected baseline path', () => {
      const key = service.computeRemoteKey(
        'breadtrans_db_protected_learner-baseline_20261023.dump',
        'PROTECTED_BASELINE',
        'baseline',
      );
      expect(key).toBe('database-backups/protected/baseline/baseline/breadtrans_db_protected_learner-baseline_20261023.dump');
    });

    it('creates protected handoff path', () => {
      const key = service.computeRemoteKey(
        'breadtrans_db_protected_handoff_20261023.dump',
        'PROTECTED_HANDOFF',
        'handoff-session',
      );
      expect(key).toBe('database-backups/protected/handoff/handoff-session/breadtrans_db_protected_handoff_20261023.dump');
    });
  });

  describe('pruneRemoteAutomaticBackups', () => {
    it('deletes expired automatic backups while preserving PROTECTED files', async () => {
      const deletedKeys: string[] = [];
      const mockClient = {
        send: jest.fn().mockImplementation(async (command: any) => {
          if (command.constructor.name === 'ListObjectsV2Command') {
            return {
              Contents: [
                {
                  Key: 'database-backups/automatic/2026/09/01/old_auto.dump',
                  LastModified: new Date(Date.now() - 20 * 24 * 3600 * 1000), // 20 days old
                },
                {
                  Key: 'database-backups/automatic/2026/10/22/new_auto.dump',
                  LastModified: new Date(Date.now() - 1 * 24 * 3600 * 1000), // 1 day old
                },
                {
                  Key: 'database-backups/automatic/2026/09/01/PROTECTED_OLD.dump',
                  LastModified: new Date(Date.now() - 30 * 24 * 3600 * 1000), // 30 days old but PROTECTED
                },
              ],
            };
          }
          if (command.constructor.name === 'DeleteObjectCommand') {
            deletedKeys.push(command.input.Key);
            return {};
          }
          return {};
        }),
      } as any;

      const pruned = await service.pruneRemoteAutomaticBackups(mockClient, 'test-bucket', 14);

      expect(pruned).toEqual(['database-backups/automatic/2026/09/01/old_auto.dump']);
      expect(deletedKeys).toEqual(['database-backups/automatic/2026/09/01/old_auto.dump']);
    });
  });
});
