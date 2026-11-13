/**
 * Writes the step-by-step grammar explanations (prisma/data/grammar-explanations)
 * into GrammarQuestion.explanation (owner 2026-11-13).
 *
 * Only a question whose id, text, options and key still match what the
 * explanation was written for is touched; everything happens in one
 * transaction. Dry run by default.
 *
 *   npx ts-node --transpile-only scripts/apply-grammar-explanations.ts            # dry run
 *   npx ts-node --transpile-only scripts/apply-grammar-explanations.ts --apply    # write
 *
 * The target is DATABASE_URL. Run `npm run db:backup` before --apply on kltn_db.
 */
import { PrismaClient } from '@prisma/client';
import {
  GRAMMAR_EXPLANATIONS,
  explanationFor,
} from '../prisma/data/grammar-explanations';

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  try {
    const [{ current_database: db, system_identifier: sid }] =
      await prisma.$queryRaw<
        Array<{ current_database: string; system_identifier: bigint }>
      >`SELECT current_database(), system_identifier FROM pg_control_system()`;
    console.log(`target: ${db} (system ${sid})`);

    const questions = await prisma.grammarQuestion.findMany({
      select: {
        id: true,
        question: true,
        options: true,
        correctIndex: true,
        explanation: true,
      },
      orderBy: { id: 'asc' },
    });
    const updates: Array<{ id: number; explanation: string }> = [];
    const mismatched: number[] = [];
    for (const q of questions) {
      const text = explanationFor(q);
      if (text === null) {
        if (GRAMMAR_EXPLANATIONS.some((x) => x.id === q.id))
          mismatched.push(q.id);
        continue;
      }
      if (q.explanation !== text) updates.push({ id: q.id, explanation: text });
    }
    const missing = questions
      .filter((q) => !GRAMMAR_EXPLANATIONS.some((x) => x.id === q.id))
      .map((q) => q.id);
    console.log(
      `questions ${questions.length}, to update ${updates.length}, content changed since written ${mismatched.length} [${mismatched.join(',')}], without an explanation entry ${missing.length} [${missing.join(',')}]`,
    );
    if (!apply) {
      console.log('dry run: nothing written (pass --apply to write)');
      return;
    }
    await prisma.$transaction(async (tx) => {
      for (const u of updates) {
        await tx.grammarQuestion.update({
          where: { id: u.id },
          data: { explanation: u.explanation },
        });
      }
    });
    console.log(`written: ${updates.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
