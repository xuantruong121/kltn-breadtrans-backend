/**
 * TOEIC fix batch D (owner approved 2026-11-06, "duyệt hết"), from
 * artifacts/toeic-content-audit-2026-11-04.md:
 *   D1  exam 3 Part 5 had 7/30 items of one type (adverb of manner); four of
 *       them (101, 109, 127, 129) now test other points: correlative
 *       either...or, unless, subject-verb agreement, so...that.
 *   D3  names reused across groups (Apex, Sarah Jenkins, David Miller, Grand
 *       Plaza...) are replaced by names of their own in 13 Part 3/4 groups:
 *       script, question text, options and explanations. Meaning and keys do
 *       not change. Audio is regenerated afterwards (the script hash changes).
 *
 * Every item is checked against its expected old content; any mismatch
 * aborts before writing. Dry run by default; --apply writes everything in one
 * transaction after saving the old rows to a rollback file.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-content-fix-d-2026-11-06.ts [--apply]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import { listeningScriptLengthIssue } from '../src/modules/toeic/toeic-listening-length';

type Rewrite = {
  examId: number;
  n: number;
  oldOptions: string[];
  oldKey: number;
  text: string;
  options: [string, string, string, string];
  key: number;
  explanation: string;
};

export const PART5: Rewrite[] = [
  {
    examId: 3,
    n: 101,
    oldOptions: ['directly', 'director', 'direct', 'direction'],
    oldKey: 0,
    text: 'Applicants may submit their registration forms _____ online or at the front desk of the main office.',
    options: ['both', 'either', 'neither', 'whether'],
    key: 1,
    explanation:
      'Cấu trúc either ... or (hoặc ... hoặc). Both đi với and, neither đi với nor, whether đi với or nhưng mở đầu mệnh đề chứ không đứng trước hai trạng ngữ như ở đây.',
  },
  {
    examId: 3,
    n: 109,
    oldOptions: ['thoroughness', 'more thorough', 'thoroughly', 'thorough'],
    oldKey: 2,
    text: 'The warehouse will not ship the order _____ the customer confirms the delivery address.',
    options: ['despite', 'because of', 'unless', 'whereas'],
    key: 2,
    explanation:
      'Unless (trừ khi) nối hai mệnh đề: kho không giao hàng trừ khi khách xác nhận địa chỉ. Despite và because of phải đi với danh từ; whereas chỉ sự tương phản, không hợp nghĩa.',
  },
  {
    examId: 3,
    n: 127,
    oldOptions: ['period', 'periodically', 'periodicity', 'periodic'],
    oldKey: 1,
    text: 'Each of the new interns _____ a laptop and an identification badge on the first day.',
    options: ['receive', 'receives', 'receiving', 'have received'],
    key: 1,
    explanation:
      'Chủ ngữ "Each of the new interns" là số ít (each), nên động từ chia receives. Receive và have received dùng cho chủ ngữ số nhiều; receiving không phải động từ chính.',
  },
  {
    examId: 3,
    n: 129,
    oldOptions: ['immediate', 'immature', 'immediacy', 'immediately'],
    oldKey: 3,
    text: 'The product launch was _____ successful that the company hired ten more sales representatives.',
    options: ['such', 'too', 'very', 'so'],
    key: 3,
    explanation:
      'Cấu trúc so + tính từ + that (đến mức mà). Such đi với danh từ (such a success that); too và very không đi với mệnh đề that chỉ kết quả.',
  },
];

/** Group id -> [old, new] pairs, applied as whole words in this order. */
export const RENAMES: Record<number, Array<[string, string]>> = {
  34: [
    ['Sarah Jenkins', 'Laura Kim'],
    ['Jenkins', 'Kim'],
    ['Sarah', 'Laura'],
    ['Apex Corporation', 'Norwell Corporation'],
  ],
  48: [
    ['David Miller', 'Martin Hale'],
    ['Miller', 'Hale'],
    ['David', 'Martin'],
    ['Sarah', 'Fiona'],
  ],
  49: [['Apex Manufacturing', 'Corvan Manufacturing']],
  50: [['David', 'Owen']],
  51: [
    ['Apex Fitness Center', 'Summit Fitness Center'],
    ['Sarah', 'Gemma'],
  ],
  1040: [
    ['Sarah', 'Nora'],
    ['David', 'Ethan'],
  ],
  1044: [
    ['Apex Shipping Services', 'Bluewave Shipping Services'],
    ['Apex Shipping', 'Bluewave Shipping'],
  ],
  1046: [['David', 'Victor']],
  1048: [
    ['Sarah Jenkins', 'Hannah Cole'],
    ['Jenkins', 'Cole'],
    ['Sarah', 'Hannah'],
  ],
  1052: [['Apex Airlines', 'Coral Airlines']],
  1053: [
    ['David Miller', 'Leo Fischer'],
    ['Miller', 'Fischer'],
    ['David', 'Leo'],
    ['Sarah', 'Teresa'],
    ['Apex Marketing', 'Brightline Marketing'],
  ],
  1056: [
    ['David', 'Marcus'],
    ['Sarah', 'Julia'],
  ],
  1058: [
    ['Grand Plaza Hotel', 'Bayview Hotel'],
    ['Grand Plaza', 'Bayview'],
    ['Sarah', 'Irene'],
  ],
};

const word = (s: string) =>
  new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
const rename = (text: string | null, pairs: Array<[string, string]>) =>
  text === null
    ? null
    : pairs.reduce((t, [from, to]) => t.replace(word(from), to), text);
const LEFTOVER = /\b(Apex|Sarah|Jenkins|David|Miller|Grand Plaza)\b/;

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(
    `target ${url.hostname}:${url.port}${url.pathname} ${apply ? 'APPLY' : 'DRY RUN'}`,
  );
  const prisma = new PrismaClient();
  const problems: string[] = [];
  const ops: any[] = [];
  const rollback: unknown[] = [];

  for (const r of PART5) {
    const rows = await prisma.toeicQuestion.findMany({
      where: { questionNumber: r.n, group: { examId: r.examId, part: 5 } },
    });
    if (rows.length !== 1) {
      problems.push(`exam ${r.examId} q${r.n}: ${rows.length} rows`);
      continue;
    }
    const row = rows[0];
    if (
      JSON.stringify(row.options) !== JSON.stringify(r.oldOptions) ||
      row.correctIndex !== r.oldKey
    )
      problems.push(`exam ${r.examId} q${r.n}: options or key changed`);
    rollback.push({ question: row });
    ops.push(
      prisma.toeicQuestion.update({
        where: { id: row.id },
        data: {
          text: r.text,
          options: r.options,
          correctIndex: r.key,
          explanation: r.explanation,
        },
      }),
    );
    console.log(`exam ${r.examId} q${r.n}: rewritten (${r.options[r.key]})`);
  }

  for (const [id, pairs] of Object.entries(RENAMES)) {
    const g = await prisma.toeicQuestionGroup.findUnique({
      where: { id: Number(id) },
      include: { questions: true },
    });
    if (!g) {
      problems.push(`group ${id}: missing`);
      continue;
    }
    if (![3, 4].includes(g.part) || ![1, 3].includes(g.examId))
      problems.push(`group ${id}: exam/part ${g.examId}/${g.part}`);
    const all = [
      g.transcriptText ?? '',
      ...g.questions.flatMap((q) => [
        q.text,
        JSON.stringify(q.options),
        q.explanation ?? '',
      ]),
    ].join('\n');
    if (!word(pairs[0][0]).test(all))
      problems.push(`group ${id}: "${pairs[0][0]}" not found`);
    const transcript = rename(g.transcriptText, pairs);
    const issue = listeningScriptLengthIssue(g.part, transcript);
    if (issue) problems.push(`group ${id}: ${issue}`);
    const questions = g.questions.map((q) => ({
      id: q.id,
      text: rename(q.text, pairs)!,
      options: (q.options as string[]).map((o) => rename(o, pairs)!),
      explanation: rename(q.explanation, pairs),
    }));
    const after = [
      transcript ?? '',
      ...questions.flatMap((q) => [
        q.text,
        q.options.join(' '),
        q.explanation ?? '',
      ]),
    ].join('\n');
    if (LEFTOVER.test(after))
      problems.push(`group ${id}: "${after.match(LEFTOVER)![0]}" left`);
    rollback.push({ group: g });
    ops.push(
      prisma.toeicQuestionGroup.update({
        where: { id: g.id },
        data: { transcriptText: transcript },
      }),
    );
    for (const q of questions)
      ops.push(
        prisma.toeicQuestion.update({
          where: { id: q.id },
          data: {
            text: q.text,
            options: q.options,
            explanation: q.explanation,
          },
        }),
      );
    console.log(
      `group ${id} (exam ${g.examId} Part ${g.part}): ${pairs.map(([a, b]) => `${a} -> ${b}`).join('; ')}`,
    );
  }

  if (problems.length) {
    console.log('ABORT, nothing written:');
    for (const p of problems) console.log('  ', p);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!apply) {
    console.log(
      `DRY RUN ok: ${PART5.length} rewrites, ${Object.keys(RENAMES).length} groups renamed, ${ops.length} rows, nothing written`,
    );
    await prisma.$disconnect();
    return;
  }
  const file = `toeic-content-fix-d-rollback-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(rollback, null, 2));
  await prisma.$transaction(ops);
  console.log(`APPLIED ${ops.length} rows; rollback file ${file}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
