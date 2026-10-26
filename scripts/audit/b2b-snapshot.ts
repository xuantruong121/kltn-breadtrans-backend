/**
 * Phase B2B read-only database snapshot.
 *
 * Captures identity, migration state, schema objects and a full-content
 * fingerprint of EVERY base table, so a before/after comparison proves which
 * rows changed rather than inferring it from row counts.
 *
 * Read-only is enforced, not merely intended: the session is opened with
 * default_transaction_read_only=on, under which PostgreSQL rejects any write
 * with SQLSTATE 25006. The application code issues no SET that would lift it.
 *
 * Usage:
 *   B2B_SNAPSHOT_URL=postgresql://... npx ts-node scripts/audit/b2b-snapshot.ts out.json
 */
import { writeFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

const base = process.env.B2B_SNAPSHOT_URL ?? '';
const out = process.argv[2];

function readOnly(url: string): string {
  const u = new URL(url);
  u.searchParams.set('options', '-c default_transaction_read_only=on');
  return u.toString();
}

async function main() {
  if (!base || !out)
    throw new Error('B2B_SNAPSHOT_URL and an output path are required');
  const prisma = new PrismaClient({
    datasources: { db: { url: readOnly(base) } },
  });
  const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

  const [id] = await q(`
    SELECT current_database() AS db,
           current_setting('server_version') AS version,
           (SELECT system_identifier::text FROM pg_control_system()) AS sysid,
           current_setting('default_transaction_read_only') AS read_only`);
  if (id.read_only !== 'on')
    throw new Error('read-only session not in effect; refusing');

  // The shadow database is emptied by Prisma after use and may have no
  // migration table at all; record that rather than failing.
  const [{ has }] = await q(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS has`,
  );
  const migrations = has
    ? await q(`
        SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
               rolled_back_at IS NOT NULL AS rolled_back
          FROM "_prisma_migrations" ORDER BY migration_name`)
    : [];

  const sourceKeyColumns = await q(`
    SELECT table_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'sourceKey'
     ORDER BY table_name`);

  const diagnosticIndexes = await q(`
    SELECT tablename, indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename LIKE 'Diagnostic%'
     ORDER BY tablename, indexname`);

  const diagnosticConstraints = await q(`
    SELECT conrelid::regclass::text AS tbl, conname, contype,
           pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace
       AND conrelid::regclass::text LIKE '"Diagnostic%'
     ORDER BY 1, 2`);

  const tables = await q<{ s: string; t: string }>(`
    SELECT table_schema AS s, table_name AS t FROM information_schema.tables
     WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')
     ORDER BY 1, 2`);

  // Whole-row fingerprint, order-independent of physical layout: rows are
  // sorted by their own text, so an UPDATE that rewrites a row to identical
  // content does not change the digest, but any change of content does.
  const tableFingerprints: Record<string, { rows: number; md5: string }> = {};
  for (const { s, t } of tables) {
    const ident = `"${s.replace(/"/g, '""')}"."${t.replace(/"/g, '""')}"`;
    const [r] = await q(`
      SELECT count(*)::int AS rows,
             coalesce(md5(string_agg(x::text, E'\\n' ORDER BY x::text)), 'empty') AS md5
        FROM ${ident} x`);
    tableFingerprints[`${s}.${t}`] = { rows: r.rows, md5: r.md5 };
  }

  // Row-version evidence for the legacy rows B2B must not touch.
  const [{ hasDiag }] = await q(
    `SELECT to_regclass('public."DiagnosticAssessment"') IS NOT NULL AS "hasDiag"`,
  );
  const legacyXmin = hasDiag
    ? {
        assessment: await q(
          `SELECT id, xmin::text AS xmin FROM "DiagnosticAssessment" WHERE id = 1`,
        ),
        questions: await q(
          `SELECT id, xmin::text AS xmin FROM "DiagnosticQuestion" WHERE "assessmentId" = 1 ORDER BY id`,
        ),
      }
    : null;

  const sequences = await q(`
    SELECT sequencename AS name, last_value::text AS last_value FROM pg_sequences
     WHERE schemaname = 'public' AND sequencename LIKE 'Diagnostic%' ORDER BY 1`);

  const snapshot = {
    takenAt: new Date().toISOString(),
    identity: {
      db: id.db,
      version: id.version,
      sysid: id.sysid,
      readOnlySession: id.read_only,
    },
    migrations,
    sourceKeyColumns,
    diagnosticIndexes,
    diagnosticConstraints,
    tableCount: tables.length,
    tableFingerprints,
    legacyXmin,
    sequences,
  };
  writeFileSync(out, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(
    `snapshot ${id.db} sysid=${id.sysid} tables=${tables.length} ` +
      `migrations=${migrations.length} sourceKeyCols=${sourceKeyColumns.length} -> ${out}`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(
    'SNAPSHOT FAILED:',
    String(e?.message ?? e)
      .split('\n')
      .slice(-2)
      .join(' '),
  );
  process.exit(2);
});
