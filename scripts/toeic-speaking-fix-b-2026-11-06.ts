/**
 * TOEIC Speaking content fix, batch B (owner approved on 2026-11-06):
 * questions 5-7 of a Speaking test share one topic, introduced once as a
 * telephone interview, as on the real test. Before, each question had its
 * own topic. Applies to the two published exam sets (exam-3-speaking for
 * S&W, exam-5-speaking for 4 Skills); the archived exam-4-speaking keeps its
 * text and the shared old clips.
 *
 * Each changed exercise gets audioUrl = null, so
 * scripts/speaking-exam-prompt-audio.ts (plan, generate, publish) reads the
 * new text aloud afterwards. No submission references these exercises
 * (checked on 2026-11-06).
 *
 * Dry run by default. --apply writes in one transaction after saving the old
 * rows to a rollback file; any mismatch with the expected old text aborts.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-speaking-fix-b-2026-11-06.ts [--apply]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

type Fix = { id: number; set: string; order: number; oldText: string; title: string; text: string };

export const FIXES: Fix[] = [
  {
    id: 36, set: 'exam-3-speaking', order: 5,
    oldText: 'Imagine a transport company is asking about commuting habits. How do you usually travel to work or school, and how long does the trip take?',
    title: 'Trả lời câu hỏi — Đi lại (câu 5)',
    text: 'Imagine that a transport company is doing research in your area. You have agreed to take part in a telephone interview about commuting. How do you usually get to work or school, and how long does the trip take?',
  },
  {
    id: 37, set: 'exam-3-speaking', order: 6,
    oldText: 'How often do you shop for groceries, and do you prefer a local market or a supermarket? Explain briefly.',
    title: 'Trả lời câu hỏi — Đi lại (câu 6)',
    text: 'Do you ever travel to work or school with other people? Why or why not?',
  },
  {
    id: 38, set: 'exam-3-speaking', order: 7,
    oldText: 'What do you usually do in your free time on weekends, and who do you spend that time with?',
    title: 'Trả lời câu hỏi — Đi lại (câu 7)',
    text: 'If a new bus or train service opened near your home, what would make you use it instead of your current way of travelling? Explain why.',
  },
  {
    id: 191, set: 'exam-5-speaking', order: 5,
    oldText: 'What is your preferred method of commuting to work, and what are the main advantages of it?',
    title: 'Workplace Training (Q5)',
    text: 'Imagine that a business magazine is doing research on workplace training. You have agreed to take part in a telephone interview. When did you last attend a training session, and what was it about?',
  },
  {
    id: 192, set: 'exam-5-speaking', order: 6,
    oldText: 'How often do you attend professional training workshops, and how do they help your career?',
    title: 'Workplace Training (Q6)',
    text: 'Do you prefer training sessions that are held online or in person? Why?',
  },
  {
    id: 193, set: 'exam-5-speaking', order: 7,
    oldText: 'What do you find most challenging about working remotely, and how do you overcome those challenges?',
    title: 'Workplace Training (Q7)',
    text: 'What kind of training would be most useful for your job or studies in the next year? Explain why.',
  },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`target ${url.hostname}:${url.port}${url.pathname} ${apply ? 'APPLY' : 'DRY RUN'}`);
  const prisma = new PrismaClient();
  const problems: string[] = [];
  const rows = [];
  for (const fix of FIXES) {
    const row = await prisma.speakingExercise.findUnique({ where: { id: fix.id } });
    if (!row) { problems.push(`exercise ${fix.id}: missing`); continue; }
    if (row.practiceSetId !== fix.set || row.order !== fix.order) problems.push(`exercise ${fix.id}: set/order ${row.practiceSetId}/${row.order}`);
    if (row.taskType !== 'RESPOND_TO_QUESTION') problems.push(`exercise ${fix.id}: taskType ${row.taskType}`);
    if (row.targetText.trim() !== fix.oldText) problems.push(`exercise ${fix.id}: text changed`);
    rows.push({ fix, row });
  }
  const submissions = await prisma.speakingSubmission.count({ where: { exerciseId: { in: FIXES.map((f) => f.id) } } });
  if (submissions) problems.push(`${submissions} submissions reference these exercises`);
  if (problems.length) {
    console.log('ABORT, nothing written:');
    for (const p of problems) console.log('  ', p);
    await prisma.$disconnect();
    process.exit(1);
  }
  for (const { fix } of rows) console.log(`exercise ${fix.id} (${fix.set} Q${fix.order}): title, targetText, audioUrl -> null`);
  if (!apply) {
    console.log(`DRY RUN ok: ${rows.length} exercises checked, nothing written`);
    await prisma.$disconnect();
    return;
  }
  const rollback = `toeic-speaking-fix-b-rollback-${Date.now()}.json`;
  writeFileSync(rollback, JSON.stringify(rows.map(({ row }) => ({ id: row.id, title: row.title, targetText: row.targetText, audioUrl: row.audioUrl })), null, 2));
  await prisma.$transaction(
    rows.map(({ fix }) =>
      prisma.speakingExercise.update({ where: { id: fix.id }, data: { title: fix.title, targetText: fix.text, audioUrl: null } }),
    ),
  );
  console.log(`APPLIED ${rows.length} exercises; rollback file ${rollback}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
