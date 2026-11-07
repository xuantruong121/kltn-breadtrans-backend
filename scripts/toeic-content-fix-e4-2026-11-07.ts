/**
 * TOEIC fix E4 (owner approved the plan on 2026-11-07): writes the rewritten
 * exam 1 Part 7 single passages of toeic-content-fix-e4-2026-11-07.data.ts.
 * Reading only, no audio. Every group must still hold its old passage (a
 * marker phrase per group) and its question numbers; the new content must
 * pass the production guards. Dry run by default; --apply writes in one
 * transaction after saving the old rows to a rollback file.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-content-fix-e4-2026-11-07.ts [--apply]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import {
  isVietnameseExplanation,
  languageIssue,
  questionContentIssue,
  readingGroupIssue,
} from '../src/modules/toeic/toeic-ai-batch.logic';
import { E4_GROUPS } from './toeic-content-fix-e4-2026-11-07.data';

const OLD_MARKER: Record<number, string> = {
  60: 'Thursday Review',
  61: 'Parking Garage Maintenance',
  62: 'BrightDesk Standing Desk',
  63: 'Customer Support Staff',
  64: 'order #8042',
  65: 'Room Change',
  66: 'Digital Skills Lab',
  67: 'Community Business Center — Wednesday',
  68: 'Water Service Interruption',
  69: 'three-day conference',
};

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`target ${url.hostname}:${url.port}${url.pathname} ${apply ? 'APPLY' : 'DRY RUN'}`);
  const prisma = new PrismaClient();
  const problems: string[] = [];
  const ops: any[] = [];
  const rollback: unknown[] = [];
  const keys = [0, 0, 0, 0];
  for (const g of E4_GROUPS) {
    const row = await prisma.toeicQuestionGroup.findUnique({
      where: { id: g.groupId },
      include: { questions: { orderBy: { questionNumber: 'asc' } } },
    });
    const tag = `group ${g.groupId}`;
    if (!row) { problems.push(`${tag}: missing`); continue; }
    if (row.examId !== 1 || row.part !== 7) problems.push(`${tag}: exam/part ${row.examId}/${row.part}`);
    if (!(row.passageText ?? '').includes(OLD_MARKER[g.groupId])) problems.push(`${tag}: old passage changed`);
    if (row.questions.map((q) => q.questionNumber).join() !== g.questions.map((q) => q.n).join()) problems.push(`${tag}: question numbers differ`);
    const batch = { passageText: g.passage, questions: g.questions.map((q) => ({ text: q.text, options: q.options, correctIndex: q.key, explanation: q.explanation })) } as any;
    for (const issue of [readingGroupIssue(7, batch), questionContentIssue(7, batch), languageIssue(batch)]) if (issue) problems.push(`${tag}: ${issue}`);
    const words = g.passage.split(/\s+/).length;
    if (words < 95 || words > 190) problems.push(`${tag}: ${words} words`);
    for (const q of g.questions) {
      keys[q.key] += 1;
      if (new Set(q.options).size !== 4) problems.push(`q${q.n}: options not distinct`);
      if (!isVietnameseExplanation(q.explanation)) problems.push(`q${q.n}: explanation not Vietnamese`);
      if (/positions marked/.test(q.text)) {
        const marks = g.passage.match(/\[[1-4]\]/g) ?? [];
        if (marks.join() !== '[1],[2],[3],[4]') problems.push(`q${q.n}: passage lacks [1]-[4]`);
      }
    }
    const markers = /positions marked/.test(g.questions.map((q) => q.text).join());
    if (!markers && /\[[1-4]\]/.test(g.passage)) problems.push(`${tag}: [n] markers without an insertion question`);
    rollback.push({ group: { id: row.id, passageText: row.passageText }, questions: row.questions.map((q) => ({ id: q.id, text: q.text, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation })) });
    ops.push(prisma.toeicQuestionGroup.update({ where: { id: row.id }, data: { passageText: g.passage } }));
    for (const q of g.questions) {
      const old = row.questions.find((x) => x.questionNumber === q.n);
      if (old) ops.push(prisma.toeicQuestion.update({ where: { id: old.id }, data: { text: q.text, options: q.options, correctIndex: q.key, explanation: q.explanation } }));
    }
    console.log(`${tag} (q${g.questions[0].n}-${g.questions.at(-1)!.n}): ${words} words, ${g.passage.split('\n')[0]}`);
  }
  console.log(`keys A/B/C/D: ${keys.join('/')}`);
  if (problems.length) {
    console.log('ABORT, nothing written:');
    for (const p of problems) console.log('  ', p);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!apply) {
    console.log(`DRY RUN ok: ${E4_GROUPS.length} groups, ${ops.length} rows, nothing written`);
    await prisma.$disconnect();
    return;
  }
  const file = `toeic-content-fix-e4-rollback-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(rollback, null, 2));
  await prisma.$transaction(ops);
  console.log(`APPLIED ${ops.length} rows; rollback file ${file}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
