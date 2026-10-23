/**
 * CLI script to trigger automated sync of all pending local database backups to Cloudflare R2.
 * Can be run standalone or via npm script: `npm run db:backup:sync-r2`.
 */
import 'dotenv/config';
import { DatabaseBackupR2SyncService } from '../src/jobs/database-backup-r2-sync.service';

async function main() {
  console.log('==================================================');
  console.log(' STARTING AUTOMATED R2 DATABASE BACKUP SYNC');
  console.log('==================================================');

  const syncService = new DatabaseBackupR2SyncService();
  const client = syncService.getClient();

  if (!client) {
    console.error('ERROR: R2 backup credentials are not properly configured in .env');
    console.error('Please check: R2_BACKUP_BUCKET_NAME, R2_BACKUP_ENDPOINT, R2_BACKUP_ACCESS_KEY_ID, R2_BACKUP_SECRET_ACCESS_KEY');
    process.exit(1);
  }

  const result = await syncService.syncPendingBackups();

  console.log('\n==================================================');
  console.log(' R2 DATABASE BACKUP SYNC RESULTS');
  console.log('==================================================');
  console.log(`Synced (${result.synced.length}):`, result.synced);
  console.log(`Skipped (${result.skipped.length}):`, result.skipped);
  console.log(`Failed (${result.failed.length}):`, result.failed);
  console.log(`Pruned (${result.pruned.length}):`, result.pruned);

  if (result.failed.length > 0) {
    console.error('\nSome files failed to sync. Review the errors above.');
    process.exit(1);
  }

  console.log('\nAll backups successfully verified and synced to R2.');
}

main().catch((err) => {
  console.error('Unhandled sync error:', err);
  process.exit(1);
});
