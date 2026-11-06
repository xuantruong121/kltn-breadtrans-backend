/**
 * Exam 2 question 1015 (ToeicQuestion.id 1015, owner approved on 2026-11-06):
 * the distractor "betterly" is not an English word; replace it with "better",
 * the same fix as exam 1 q107 in batch A1. Key (index 1, "well") unchanged.
 *
 * Dry run by default. --apply writes only if the row still holds the old
 * options and key, and saves the old row to a rollback file first.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-content-fix-q1015-2026-11-06.ts [--apply]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const ID = 1015;
const OLD = ['goodness', 'well', 'good', 'betterly'];
const NEW = ['goodness', 'well', 'good', 'better'];
const EXPLANATION =
  'Cần trạng từ bổ nghĩa cho động từ performed; trạng từ của good là well. Very không đi với dạng so sánh better, còn good là tính từ và goodness là danh từ.';

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`target ${url.hostname}:${url.port}${url.pathname} ${apply ? 'APPLY' : 'DRY RUN'}`);
  const prisma = new PrismaClient();
  const row = await prisma.toeicQuestion.findUnique({ where: { id: ID } });
  if (!row || row.correctIndex !== 1 || JSON.stringify(row.options) !== JSON.stringify(OLD)) {
    console.log('ABORT, nothing written: row missing or already changed', row ? JSON.stringify(row.options) : '');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`question ${ID}: ${JSON.stringify(OLD)} -> ${JSON.stringify(NEW)}, explanation updated`);
  if (!apply) {
    console.log('DRY RUN ok, nothing written');
    await prisma.$disconnect();
    return;
  }
  const rollback = `toeic-content-fix-q1015-rollback-${Date.now()}.json`;
  writeFileSync(rollback, JSON.stringify({ id: ID, options: row.options, explanation: row.explanation }, null, 2));
  await prisma.toeicQuestion.update({ where: { id: ID }, data: { options: NEW, explanation: EXPLANATION } });
  console.log(`APPLIED; rollback file ${rollback}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
