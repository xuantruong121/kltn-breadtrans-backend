/**
 * TOEIC content fixes, batch A1 (owner approved on 2026-11-06), from the
 * findings of artifacts/toeic-content-audit-2026-11-04.md:
 *   - exam 1 Part 5–6: replace distractors that are not English or not
 *     grammatical options (betterly, was been, has agreeing...);
 *   - exam 3: q103 "within the next month", q34 options as actions, q47
 *     "late delivery" for a parcel that was only delayed.
 * The correct answer and its position never change, so stored attempts keep
 * their meaning; no audio is affected (Part 3 options are not read aloud).
 *
 * Every item is located by exam id + question number and must still hold the
 * expected old options and key; any mismatch aborts before writing.
 * Dry run by default. --apply writes all items in one transaction after
 * saving the old rows to a rollback file.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-content-fix-a1-2026-11-06.ts [--apply]
 * Target: DATABASE_URL (an explicit environment variable overrides .env).
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

type Fix = {
  examId: number;
  n: number;
  part: number;
  key: number;
  oldOptions: string[];
  newOptions?: string[];
  oldText?: string;
  newText?: string;
  newExplanation?: string;
  /** The correct option is reworded on purpose (same position, same meaning). */
  rewordKey?: boolean;
};

export const FIXES: Fix[] = [
  {
    examId: 1, n: 107, part: 5, key: 1,
    oldOptions: ['goodness', 'well', 'good', 'betterly'],
    newOptions: ['goodness', 'well', 'good', 'better'],
    newExplanation:
      'Cần trạng từ bổ nghĩa cho động từ performed; trạng từ của good là well. Very không đi với dạng so sánh better, còn good là tính từ và goodness là danh từ.',
  },
  {
    examId: 1, n: 113, part: 5, key: 3,
    oldOptions: ['expanding after plans', 'expanded', 'expand to', 'to expand'],
    newOptions: ['expanding', 'expanded', 'expansion', 'to expand'],
  },
  {
    examId: 1, n: 119, part: 5, key: 0,
    oldOptions: ['because', 'despite', 'therefore of', 'however'],
    newOptions: ['because', 'despite', 'therefore', 'however'],
    newExplanation:
      'Sau chỗ trống là mệnh đề nêu lý do (người hướng dẫn bị ốm), nên dùng liên từ because. Despite cần danh từ; therefore và however là trạng từ, không nối hai mệnh đề.',
  },
  {
    examId: 1, n: 128, part: 5, key: 0,
    oldOptions: ['order', 'addition of', 'spite', 'case'],
    newOptions: ['order', 'addition', 'spite', 'case'],
  },
  {
    examId: 1, n: 130, part: 5, key: 1,
    oldOptions: ['whose company', 'who', 'which place', 'where'],
    newOptions: ['whose', 'who', 'whom', 'where'],
    newExplanation:
      'Who thay cho two references (người giới thiệu, chỉ người) và làm chủ ngữ của can confirm. Whom là tân ngữ nên không làm chủ ngữ được; whose cần danh từ theo sau.',
  },
  {
    examId: 1, n: 135, part: 6, key: 2,
    oldOptions: ['has', 'being', 'will be', 'was been'],
    newOptions: ['has', 'being', 'will be', 'was'],
    newExplanation:
      'Thứ Bảy này là thời điểm trong tương lai, nên dùng will be closed. Was chỉ quá khứ, không hợp với thứ Bảy sắp tới.',
  },
  {
    examId: 1, n: 137, part: 6, key: 3,
    oldOptions: ['visiting', 'visited', 'are visit', 'may visit'],
    newOptions: ['visiting', 'visited', 'to visit', 'may visit'],
  },
  {
    examId: 1, n: 139, part: 6, key: 0,
    oldOptions: ['will begin', 'began', 'has begun yesterday', 'beginning'],
    newOptions: ['will begin', 'began', 'has begun', 'beginning'],
    newExplanation:
      'Next week chỉ tương lai, nên dùng will begin. Began và has begun chỉ việc đã xảy ra.',
  },
  {
    examId: 1, n: 140, part: 6, key: 2,
    oldOptions: ['has agreeing', 'agree', 'have agreed', 'was agreed'],
    newOptions: ['has agreed', 'agreeing', 'have agreed', 'was agreed'],
    newExplanation:
      'Chủ ngữ số nhiều Twenty volunteers đi với have agreed (đã đồng ý). Has agreed sai số với chủ ngữ số nhiều, agreeing không phải động từ chính, còn was agreed sai số và sai thể.',
  },
  {
    examId: 3, n: 103, part: 5, key: 3,
    oldOptions: ['since', 'among', 'between', 'within'],
    oldText: 'The human resources director will conduct performance reviews for all staff members _____ next month.',
    newText: 'The human resources director will conduct performance reviews for all staff members _____ the next month.',
  },
  {
    examId: 3, n: 34, part: 3, key: 0, rewordKey: true,
    oldOptions: ['He needs to go to Gate 14.', 'His flight is delayed by an hour.', 'His luggage is overweight.', 'Boarding will start in ten minutes.'],
    newOptions: ['Go to Gate 14', 'Pay a baggage fee', 'Choose a different seat', 'Show his passport again'],
    newExplanation:
      'Đáp án: Go to Gate 14. Nhân viên đưa thẻ lên máy bay và nói "Your flight will be boarding from Gate 14 in about thirty minutes", tức là việc tiếp theo của người đàn ông là đến Cổng 14.',
  },
  {
    examId: 3, n: 47, part: 3, key: 2, rewordKey: true,
    oldOptions: ['A billing error', 'A delayed flight', 'A missing parcel', 'A damaged product'],
    newOptions: ['A billing error', 'A canceled order', 'A late delivery', 'A damaged product'],
    newExplanation:
      'Đáp án: A late delivery. Bưu kiện gửi từ thứ Ba tuần trước "still has not arrived" vì bị giữ ở hải quan để kiểm tra; nhân viên cho biết chiều nay sẽ giao. Bưu kiện chỉ đến trễ, không bị mất.',
  },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`target ${url.hostname}:${url.port}${url.pathname} ${apply ? 'APPLY' : 'DRY RUN'}`);
  const prisma = new PrismaClient();
  const rows: Array<{ fix: Fix; row: any }> = [];
  const problems: string[] = [];
  for (const fix of FIXES) {
    const found = await prisma.toeicQuestion.findMany({
      where: { questionNumber: fix.n, group: { examId: fix.examId } },
      include: { group: { select: { part: true } } },
    });
    if (found.length !== 1) {
      problems.push(`exam ${fix.examId} q${fix.n}: ${found.length} rows`);
      continue;
    }
    const row = found[0];
    const opts = row.options as unknown as string[];
    if (row.group.part !== fix.part) problems.push(`exam ${fix.examId} q${fix.n}: part ${row.group.part}`);
    if (row.correctIndex !== fix.key) problems.push(`exam ${fix.examId} q${fix.n}: key ${row.correctIndex}`);
    if (JSON.stringify(opts) !== JSON.stringify(fix.oldOptions))
      problems.push(`exam ${fix.examId} q${fix.n}: options changed ${JSON.stringify(opts)}`);
    if (fix.oldText && row.text !== fix.oldText) problems.push(`exam ${fix.examId} q${fix.n}: text changed`);
    if (fix.newOptions && fix.newOptions.length !== opts.length)
      problems.push(`exam ${fix.examId} q${fix.n}: option count`);
    if (fix.newOptions && !fix.rewordKey && fix.newOptions[fix.key] !== opts[fix.key])
      problems.push(`exam ${fix.examId} q${fix.n}: the correct option text would change`);
    rows.push({ fix, row });
  }
  if (problems.length) {
    console.log('ABORT, nothing written:');
    for (const p of problems) console.log('  ', p);
    await prisma.$disconnect();
    process.exit(1);
  }
  for (const { fix, row } of rows)
    console.log(
      `exam ${fix.examId} q${fix.n}: ${fix.newOptions ? JSON.stringify(row.options) + ' -> ' + JSON.stringify(fix.newOptions) : ''}${fix.newText ? ' text updated' : ''}${fix.newExplanation ? ' explanation updated' : ''}`,
    );
  if (!apply) {
    console.log(`DRY RUN ok: ${rows.length} items checked, nothing written`);
    await prisma.$disconnect();
    return;
  }
  const rollback = `toeic-content-fix-a1-rollback-${Date.now()}.json`;
  writeFileSync(
    rollback,
    JSON.stringify(rows.map(({ row }) => ({ id: row.id, text: row.text, options: row.options, explanation: row.explanation })), null, 2),
  );
  await prisma.$transaction(
    rows.map(({ fix, row }) =>
      prisma.toeicQuestion.update({
        where: { id: row.id },
        data: {
          ...(fix.newOptions ? { options: fix.newOptions } : {}),
          ...(fix.newText ? { text: fix.newText } : {}),
          ...(fix.newExplanation ? { explanation: fix.newExplanation } : {}),
        },
      }),
    ),
  );
  console.log(`APPLIED ${rows.length} items; rollback file ${rollback}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
