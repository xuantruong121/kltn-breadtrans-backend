/**
 * TOEIC fixes E3 and E5 (owner approved the plan on 2026-11-07), from
 * artifacts/toeic-published-content-ux-audit-2026-11-06.md.
 *   E3  exam 1: q144/q145 distractors that are not usable verb forms, q77 a
 *       distractor too close to the key, q59 wording, q192 a passage line the
 *       key relied on loosely. Keys and their positions do not change; Part 3
 *       and 4 options are not read aloud, Part 6 and 7 have no audio.
 *   E5  exam-3-speaking: read-aloud Q1-2 lengthened to 45-55 words (no prompt
 *       audio for read aloud), and the Q8-10 schedule no longer carries the
 *       BreadTrans name.
 *
 * Dry run by default; --apply writes everything in one transaction after
 * saving the old rows to a rollback file. Any mismatch with the expected old
 * content aborts before writing.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-content-fix-e35-2026-11-07.ts [--apply]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

type QFix = {
  n: number;
  oldOptions: string[];
  key: number;
  options: string[];
  explanation?: string;
};

export const QUESTIONS: QFix[] = [
  {
    n: 144,
    oldOptions: ['begin', 'has beginning', 'was begin', 'will begin'],
    key: 3,
    options: ['began', 'had begun', 'has begun', 'will begin'],
    explanation:
      'Phiên khai mạc là sự kiện sắp diễn ra (lùi 30 phút so với lịch cũ), nên dùng thì tương lai will begin. Began, had begun và has begun đều chỉ việc đã xảy ra.',
  },
  {
    n: 145,
    oldOptions: ['will still', 'still were', 'have still', 'still being'],
    key: 0,
    options: ['will still', 'were still', 'have still been', 'still being'],
    explanation:
      'Bàn đăng ký mở vào ngày diễn đàn sắp tới, nên dùng will still open (vẫn mở lúc 8:30 như cũ). Were still chỉ quá khứ, have still been chỉ hiện tại hoàn thành, still being không làm động từ chính được.',
  },
  {
    n: 77,
    oldOptions: ['A new product launch', 'A marketing strategy', 'A budget reduction', 'An office relocation'],
    key: 0,
    options: ['A new product launch', 'A customer survey', 'A budget reduction', 'An office relocation'],
  },
  {
    n: 59,
    oldOptions: ['To apply for a job', 'To book a venue', 'To return a damaged item', 'To ask about store hours'],
    key: 2,
    options: ['To apply for a job', 'To book a venue', 'To return a defective item', 'To ask about store hours'],
  },
  {
    n: 192,
    oldOptions: ['The Garden Room is closed', 'Lunch was canceled', 'Priya is a speaker', 'He can attend only in the afternoon'],
    key: 3,
    options: ['The Garden Room is closed', 'Lunch was canceled', 'Priya is a speaker', 'He can attend only after 1 P.M.'],
    explanation:
      'Marco viết rằng anh chỉ tham dự được sau 1 giờ chiều, còn bữa trưa ở Garden Room bắt đầu lúc 12:00, nên anh đề nghị hẹn uống cà phê vào hôm khác.',
  },
];

const PASSAGE_192 = {
  groupId: 73,
  old: 'Hi Priya, I can attend only in the afternoon.',
  new: 'Hi Priya, I can attend only after 1 P.M.',
};

export const SPEAKING = [
  {
    id: 32,
    set: 'exam-3-speaking',
    order: 1,
    oldStart: 'Thank you for shopping with us today.',
    text: 'Thank you for shopping with us today. Our customer service desk is on the second floor, next to the escalator, and it stays open until nine in the evening. To return or exchange an item, please bring your receipt. Rewards members can also collect their points at the desk.',
  },
  {
    id: 33,
    set: 'exam-3-speaking',
    order: 2,
    oldStart: 'Good afternoon, passengers.',
    text: 'Good afternoon, passengers. Boarding for flight two-one-four to Da Nang will begin in about fifteen minutes at gate seven. Passengers with small children and those who need extra assistance will board first. Please have your boarding pass and identification ready, and make sure your carry-on bag fits under the seat in front of you.',
  },
];

const STIMULUS_2 = { id: 2, old: 'BreadTrans Training Day', new: 'Riverside Business Center — Training Day' };

const words = (s: string) => s.trim().split(/\s+/).length;

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`target ${url.hostname}:${url.port}${url.pathname} ${apply ? 'APPLY' : 'DRY RUN'}`);
  const prisma = new PrismaClient();
  const problems: string[] = [];
  const ops: any[] = [];
  const rollback: unknown[] = [];

  for (const f of QUESTIONS) {
    const rows = await prisma.toeicQuestion.findMany({ where: { questionNumber: f.n, group: { examId: 1 } } });
    if (rows.length !== 1) { problems.push(`q${f.n}: ${rows.length} rows`); continue; }
    const q = rows[0];
    if (JSON.stringify(q.options) !== JSON.stringify(f.oldOptions)) problems.push(`q${f.n}: options changed`);
    if (q.correctIndex !== f.key) problems.push(`q${f.n}: key changed`);
    if (new Set(f.options).size !== 4) problems.push(`q${f.n}: new options not distinct`);
    rollback.push({ question: { id: q.id, options: q.options, explanation: q.explanation } });
    ops.push(prisma.toeicQuestion.update({ where: { id: q.id }, data: { options: f.options, ...(f.explanation ? { explanation: f.explanation } : {}) } }));
    console.log(`q${f.n}: ${f.oldOptions.filter((o, i) => o !== f.options[i]).join(' / ')} -> ${f.options.filter((o, i) => o !== f.oldOptions[i]).join(' / ')}`);
  }

  const g = await prisma.toeicQuestionGroup.findUnique({ where: { id: PASSAGE_192.groupId } });
  if (!g || g.examId !== 1 || !(g.passageText ?? '').includes(PASSAGE_192.old)) problems.push('group 73: passage changed');
  else {
    rollback.push({ group: { id: g.id, passageText: g.passageText } });
    ops.push(prisma.toeicQuestionGroup.update({ where: { id: g.id }, data: { passageText: g.passageText!.replace(PASSAGE_192.old, PASSAGE_192.new) } }));
    console.log(`group 73: "${PASSAGE_192.old}" -> "${PASSAGE_192.new}"`);
  }

  const subs = await prisma.speakingSubmission.count({ where: { exercise: { practiceSetId: 'exam-3-speaking' } } as any });
  if (subs) problems.push(`exam-3-speaking has ${subs} submissions`);
  for (const s of SPEAKING) {
    const e = await prisma.speakingExercise.findUnique({ where: { id: s.id } });
    if (!e || e.practiceSetId !== s.set || e.order !== s.order || e.taskType !== 'READ_ALOUD' || !e.targetText.startsWith(s.oldStart))
      { problems.push(`exercise ${s.id}: changed`); continue; }
    if (e.audioUrl) problems.push(`exercise ${s.id}: has audio`);
    const n = words(s.text);
    if (n < 45 || n > 60) problems.push(`exercise ${s.id}: ${n} words`);
    rollback.push({ exercise: { id: e.id, targetText: e.targetText } });
    ops.push(prisma.speakingExercise.update({ where: { id: e.id }, data: { targetText: s.text } }));
    console.log(`exercise ${s.id} (Q${s.order}): ${words(e.targetText)} -> ${n} words`);
  }
  const st = await prisma.speakingStimulus.findUnique({ where: { id: STIMULUS_2.id } });
  if (!st || !(st.content ?? "").startsWith(STIMULUS_2.old)) problems.push('stimulus 2: changed');
  else {
    rollback.push({ stimulus: { id: st.id, content: st.content } });
    ops.push(prisma.speakingStimulus.update({ where: { id: st.id }, data: { content: (st.content ?? "").replace(STIMULUS_2.old, STIMULUS_2.new) } }));
    console.log(`stimulus 2: "${STIMULUS_2.old}" -> "${STIMULUS_2.new}"`);
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
  const file = `toeic-content-fix-e35-rollback-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(rollback, null, 2));
  await prisma.$transaction(ops);
  console.log(`APPLIED ${ops.length} rows; rollback file ${file}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
