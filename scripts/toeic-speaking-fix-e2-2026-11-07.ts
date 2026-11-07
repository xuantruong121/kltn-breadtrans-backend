/**
 * TOEIC fix E2 (owner approved the plan on 2026-11-07): 4 Skills Đề 02
 * Speaking Q8-10 (exam-5-speaking, stimulus 8).
 *   - The schedule was one run-on paragraph under the generator's fixed title
 *     "TOEIC Speaking information source". It becomes one item per line under
 *     "Lịch hội nghị", like the S&W set (the room strips the exam title prefix,
 *     SpeakingRoom.tsx).
 *   - Q9 follows the real test: the caller states something wrong and the
 *     test taker corrects it. Its prompt audio is cleared, so
 *     scripts/speaking-exam-prompt-audio.ts reads the new text afterwards.
 *   - The keynote speaker's name, reused elsewhere, is replaced.
 *
 * Dry run by default; --apply writes in one transaction after saving the old
 * rows to a rollback file.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-speaking-fix-e2-2026-11-07.ts [--apply]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const EXAM_TITLE = 'TOEIC 4 Skills — Đề luyện tập 02';
export const STIMULUS = {
  id: 8,
  oldTitle: 'TOEIC Speaking information source',
  oldStart: 'Annual Marketing Summit Schedule. Day One:',
  title: `${EXAM_TITLE} — Lịch hội nghị`,
  content: [
    'Annual Marketing Summit — Schedule',
    'Day One',
    '9:00 AM  Registration and Breakfast — Lobby',
    '10:00 AM  Keynote Presentation by Olivia Bennett — Hall A',
    '12:00 PM  Networking Lunch — Main Dining Room',
    '1:30 PM  Breakout Sessions by Industry — Rooms 201–204',
    'Day Two',
    '9:30 AM  Panel Discussion: Digital Trends — Hall A',
    '11:00 AM  Product Demonstration Workshop — Hall B',
    '1:00 PM  Closing Remarks and Awards Ceremony — Hall A',
  ].join('\n'),
};
export const Q9 = {
  id: 195,
  oldStart: 'Where will the networking lunch take place',
  text: 'I heard the keynote presentation is on the second day. Is that right?',
};

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`target ${url.hostname}:${url.port}${url.pathname} ${apply ? 'APPLY' : 'DRY RUN'}`);
  const prisma = new PrismaClient();
  const problems: string[] = [];
  const st = await prisma.speakingStimulus.findUnique({ where: { id: STIMULUS.id } });
  if (!st || st.title !== STIMULUS.oldTitle || !(st.content ?? "").startsWith(STIMULUS.oldStart)) problems.push('stimulus 8 changed');
  const q9 = await prisma.speakingExercise.findUnique({ where: { id: Q9.id } });
  if (!q9 || q9.practiceSetId !== 'exam-5-speaking' || q9.order !== 9 || q9.stimulusId !== 8 || !q9.targetText.startsWith(Q9.oldStart))
    problems.push('Q9 changed');
  const users = await prisma.speakingExercise.findMany({ where: { stimulusId: STIMULUS.id }, select: { practiceSetId: true } });
  if (users.some((u) => u.practiceSetId !== 'exam-5-speaking')) problems.push('stimulus 8 is shared with another set');
  const subs = await prisma.speakingSubmission.count({ where: { exercise: { practiceSetId: 'exam-5-speaking' } } as any });
  if (subs) problems.push(`exam-5-speaking has ${subs} submissions`);
  if (problems.length) {
    console.log('ABORT, nothing written:');
    for (const p of problems) console.log('  ', p);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`stimulus 8: title -> "${STIMULUS.title}", ${STIMULUS.content.split('\n').length} lines`);
  console.log(`Q9: "${q9!.targetText}" -> "${Q9.text}", audioUrl -> null`);
  if (!apply) {
    console.log('DRY RUN ok, nothing written');
    await prisma.$disconnect();
    return;
  }
  const file = `toeic-speaking-fix-e2-rollback-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify({ stimulus: st, q9: { id: q9!.id, targetText: q9!.targetText, audioUrl: q9!.audioUrl } }, null, 2));
  await prisma.$transaction([
    prisma.speakingStimulus.update({ where: { id: STIMULUS.id }, data: { title: STIMULUS.title, content: STIMULUS.content } }),
    prisma.speakingExercise.update({ where: { id: Q9.id }, data: { targetText: Q9.text, audioUrl: null } }),
  ]);
  console.log(`APPLIED; rollback file ${file}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
