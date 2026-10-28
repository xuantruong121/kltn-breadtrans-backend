/**
 * Import first in a pre-CP60 QA script. Those scripts default to the owner app
 * (:3000/:3001) and to the backend `.env` database (kltn_db) and they create,
 * change or delete rows. They stop here unless the owner approved this run
 * explicitly; port a script to the harness helpers (or qa-target-guard) to
 * use it routinely.
 */
import { basename } from 'node:path';

import { requireExplicitOptIn } from './qa-target-guard';

requireExplicitOptIn(
  'QA_LEGACY_SCRIPT_OWNER_APPROVED',
  `${basename(process.argv[1] ?? 'script')} is a pre-CP60 QA script that targets the owner app and the backend .env database`,
);
