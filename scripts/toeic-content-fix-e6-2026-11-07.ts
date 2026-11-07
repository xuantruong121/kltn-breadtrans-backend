/**
 * TOEIC fix E6 (owner approved the plan on 2026-11-07): Part 1 keys of the
 * published exams sat on A and B only (exam 1: 2/2/0/2, exam 3: 4/2/0/0).
 * The correct statement of five items moves to another position by swapping
 * it with one distractor; the statements themselves do not change. Exam 1
 * explanations name the letters, so they are rewritten for the new order.
 * Part 1 audio reads the statements A-D, so the five group clips are
 * regenerated afterwards (their script hash changes) and both listening
 * masters rebuilt.
 *
 * Old attempts store an option index; their review of these items will show
 * the swapped order (owner accepted on 2026-11-07).
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-content-fix-e6-2026-11-07.ts [--apply]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

type Swap = { examId: number; n: number; from: number; to: number; correct: string; explanation?: string };

export const SWAPS: Swap[] = [
  {
    examId: 1, n: 2, from: 3, to: 2, correct: 'The workers are reviewing a plan.',
    explanation:
      'Hai công nhân đội mũ bảo hộ đang cùng xem bản vẽ, nên C (The workers are reviewing a plan) đúng. Bức tường không được sơn (A), mũ đang đội trên đầu chứ không nằm dưới đất (B), không ai trồng cây (D).',
  },
  {
    examId: 1, n: 5, from: 1, to: 2, correct: 'A man is working on a light fixture.',
    explanation:
      'Người đàn ông đứng trên thang, hai tay đang thao tác với đèn trần, nên C (A man is working on a light fixture) đúng. Đèn không được đóng thùng (A), thang đặt trong hành lang chứ không bị mang ra ngoài (B), sàn không được lau (D).',
  },
  { examId: 3, n: 3, from: 0, to: 2, correct: 'Large sacks are piled on the back of a pickup truck.' },
  { examId: 3, n: 4, from: 0, to: 3, correct: 'A yellow chair is positioned next to an outdoor table.' },
  { examId: 3, n: 6, from: 0, to: 3, correct: 'Potted plants are set outside in front of the store windows.' },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`target ${url.hostname}:${url.port}${url.pathname} ${apply ? 'APPLY' : 'DRY RUN'}`);
  const prisma = new PrismaClient();
  const problems: string[] = [];
  const ops: any[] = [];
  const rollback: unknown[] = [];
  for (const s of SWAPS) {
    const rows = await prisma.toeicQuestion.findMany({ where: { questionNumber: s.n, group: { examId: s.examId, part: 1 } } });
    const tag = `exam ${s.examId} q${s.n}`;
    if (rows.length !== 1) { problems.push(`${tag}: ${rows.length} rows`); continue; }
    const q = rows[0];
    const opts = q.options as string[];
    if (q.correctIndex !== s.from || opts[s.from] !== s.correct) { problems.push(`${tag}: key or statement changed`); continue; }
    const next = [...opts];
    [next[s.from], next[s.to]] = [next[s.to], next[s.from]];
    const explanation = s.explanation ?? q.explanation ?? '';
    if (!s.explanation && /\b[A-D]\s*\(|\([A-D]\)/.test(explanation)) problems.push(`${tag}: explanation names letters, needs a rewrite`);
    rollback.push({ id: q.id, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation });
    ops.push(prisma.toeicQuestion.update({ where: { id: q.id }, data: { options: next, correctIndex: s.to, ...(s.explanation ? { explanation: s.explanation } : {}) } }));
    console.log(`${tag}: key ${'ABCD'[s.from]} -> ${'ABCD'[s.to]} (${s.correct})`);
  }
  if (problems.length) {
    console.log('ABORT, nothing written:');
    for (const p of problems) console.log('  ', p);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!apply) {
    console.log(`DRY RUN ok: ${ops.length} rows, nothing written`);
    await prisma.$disconnect();
    return;
  }
  const file = `toeic-content-fix-e6-rollback-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(rollback, null, 2));
  await prisma.$transaction(ops);
  console.log(`APPLIED ${ops.length} rows; rollback file ${file}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
