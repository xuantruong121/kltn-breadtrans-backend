/**
 * Re-synchronise PostgreSQL identity sequences after a seed/reconstruction
 * that inserts explicit primary keys.
 *
 * Why this exists
 * ---------------
 * `prisma/seed.ts` deliberately writes stable explicit ids (for example TOEIC
 * question groups 1..54 so media object keys stay valid across reseeds). A
 * sequence is only advanced when Postgres itself generates the value, so after
 * such a seed the sequences remain far behind `max(id)`. The next ordinary
 * `create()` then reuses a low id and fails with:
 *
 *     Unique constraint failed on the fields: (`id`)
 *
 * That affected 25 tables after the 2026-10-23 reconstruction (for example
 * SpeakingExercise seq=5 vs max(id)=30) and broke both the application's
 * ability to create new rows and the Speaking integration test suite.
 *
 * This script sets every public identity sequence to its table's current
 * max(id). It is idempotent and safe to run repeatedly.
 *
 * Usage:
 *   npx ts-node scripts/db-resync-sequences.ts
 *   npx ts-node scripts/db-resync-sequences.ts --check   # report only
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

type SequenceRow = {
  table_name: string;
  sequence_name: string;
  seq_last: string | null;
  max_id: string | null;
};

/**
 * Finds every sequence owned by an `id` column of a public table, with the
 * sequence's current value and the table's current max(id). query_to_xml is
 * used so one statement can read max(id) from dynamically named tables.
 */
const INSPECT_SQL = `
  SELECT c.relname AS table_name,
         s.relname AS sequence_name,
         pg_sequence_last_value(s.oid)::text AS seq_last,
         (xpath('/row/m/text()',
           query_to_xml(format('SELECT COALESCE(max(%I),0) AS m FROM %I', a.attname, c.relname),
                        false, true, '')))[1]::text AS max_id
  FROM pg_class s
  JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.deptype = 'a'
  JOIN pg_class c ON c.oid = d.refobjid
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
  WHERE s.relkind = 'S'
    AND c.relkind = 'r'
    AND c.relnamespace = 'public'::regnamespace
  ORDER BY c.relname;
`;

export async function resyncSequences(prisma: PrismaClient, checkOnly = false) {
  const rows = await prisma.$queryRawUnsafe<SequenceRow[]>(INSPECT_SQL);

  const behind = rows.filter((row) => {
    const maxId = Number(row.max_id ?? 0);
    // seq_last is null when the sequence has never been used at all, which is
    // the worst case: the next insert would start from 1.
    const seqLast = row.seq_last === null ? 0 : Number(row.seq_last);
    return maxId > seqLast;
  });

  if (!behind.length) {
    console.log(`All ${rows.length} identity sequences are in sync.`);
    return { inspected: rows.length, behind: 0, repaired: 0 };
  }

  console.log(
    `${behind.length} of ${rows.length} identity sequences are behind their table's max(id):`,
  );
  for (const row of behind)
    console.log(
      `  ${row.table_name.padEnd(32)} seq=${(row.seq_last ?? 'unset').padStart(6)}  max_id=${row.max_id}`,
    );

  if (checkOnly) {
    console.log('\n--check given: no sequences were modified.');
    return { inspected: rows.length, behind: behind.length, repaired: 0 };
  }

  let repaired = 0;
  for (const row of behind) {
    const maxId = Number(row.max_id ?? 0);
    // setval(..., is_called = true) means the NEXT value is maxId + 1.
    await prisma.$executeRawUnsafe(
      `SELECT setval('"' || $1 || '"', $2::bigint, true)`,
      row.sequence_name,
      Math.max(maxId, 1),
    );
    repaired += 1;
  }

  console.log(`\nRepaired ${repaired} sequences.`);
  return { inspected: rows.length, behind: behind.length, repaired };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  const checkOnly = process.argv.includes('--check');
  void resyncSequences(prisma, checkOnly)
    .catch((error) => {
      console.error(
        'Sequence resync failed:',
        error instanceof Error ? error.message : error,
      );
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
