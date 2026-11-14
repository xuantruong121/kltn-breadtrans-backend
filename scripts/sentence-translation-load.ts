/**
 * Adds the "Dịch câu" Writing exercises (8 exercises, 6 sentences each) to the
 * database in DATABASE_URL.
 *
 * Dry run by default: prints the target and what would be created. With
 * --apply it writes inside one transaction (a failure leaves nothing). Only
 * creates what is missing (by quiz title), so a rerun writes nothing.
 *
 * Usage: npx ts-node --transpile-only scripts/sentence-translation-load.ts [--apply]
 */
import { PrismaClient } from '@prisma/client';

import {
  applySentenceTranslation,
  assertSentenceTranslationContent,
  sentenceTranslationPlan,
} from '../prisma/data/sentence-translation-apply';

async function main() {
  const apply = process.argv.includes('--apply');
  assertSentenceTranslationContent();
  const prisma = new PrismaClient();
  try {
    const [{ db, sysid }] = await prisma.$queryRawUnsafe<
      Array<{ db: string; sysid: string }>
    >(
      'select current_database() db, system_identifier::text sysid from pg_control_system()',
    );
    console.log(`target: ${db} (system ${sysid})`);
    const plan = await sentenceTranslationPlan(prisma);
    console.log(
      `topic ${plan.topicId ?? '(to create)'}, exercises to create ${plan.missing.length}: ${plan.missing.map((e) => e.title).join(' | ') || '-'}`,
    );
    if (!apply) {
      console.log('dry run: nothing written (pass --apply to write)');
      return;
    }
    const out = await prisma.$transaction(
      (tx) => applySentenceTranslation(tx),
      {
        timeout: 60_000,
      },
    );
    console.log(
      `written: topic ${out.topicId}, ${out.created.length} exercises`,
    );
    for (const line of out.created) console.log(`  ${line}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
