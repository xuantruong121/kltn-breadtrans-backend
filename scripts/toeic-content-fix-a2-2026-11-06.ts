/**
 * TOEIC Writing content fixes, batch A2 (owner approved on 2026-11-06).
 *   - Writing sets 1 and 2 (quizzes 34-36, 42-44): questions 6-7 drop the
 *     "at least 25 words" floor (TOEIC sets none), the essay asks for at
 *     least 300 words instead of 150.
 *   - Writing set 3 (quizzes 83-90): picture tasks keep exactly two keywords;
 *     questions 6-7 get the e-mail the learner answers (the grader reads it)
 *     and lose the invented word range; the essay asks for at least 300 words.
 *
 * The grader reads prompt, e-mail and keywords only; wordRange is display
 * data. Submissions already stored are not touched.
 *
 * Every row is located by Question.id and must still hold the expected old
 * prompt (and keywords, when changed); any mismatch aborts before writing.
 * Dry run by default. --apply writes all rows in one transaction after
 * saving the old content to a rollback file.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-content-fix-a2-2026-11-06.ts [--apply]
 * Target: DATABASE_URL (an explicit environment variable overrides .env).
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

type Fix = {
  id: number;
  oldPrompt: string;
  oldKeywords?: string[];
  prompt: string;
  keywords?: string[];
  email?: string;
  /** null removes the field. */
  wordRange?: [number, number] | null;
};

const PICTURE_OLD = 'Write one complete sentence about the image using the required keywords.';
const PICTURE_NEW = 'Write ONE sentence about the picture using both keywords.';

const MEETING_OLD =
  'Read the e-mail from a colleague who needs to move a team meeting. Reply in at least 25 words: confirm a new time, suggest a room, and ask one question.';
const MEETING_NEW =
  'Read the e-mail from a colleague who needs to move a team meeting. Respond to the e-mail: confirm a new time, suggest a room, and ask one question.';
const ORDER_OLD =
  'A customer writes that part of their order is missing. Reply in at least 25 words: apologise, explain the next step, and request one piece of information.';
const ORDER_NEW =
  'A customer writes that part of their order is missing. Respond to the e-mail: apologise, explain the next step, and request one piece of information.';
const ONLINE_OLD =
  'Do you agree or disagree that online courses are as effective as classroom lessons for learning English? Write at least 150 words with reasons and examples.';
const ONLINE_NEW =
  'Do you agree or disagree that online courses are as effective as classroom lessons for learning English? Write at least 300 words with reasons and examples.';
const HOME_OLD =
  'Do you agree or disagree with the statement that employees are more productive working from home than working in a traditional office? Give reasons and specific examples to support your opinion.';

export const FIXES: Fix[] = [
  // Sets 1 and 2 (set 2 is a copy of set 1).
  { id: 186, oldPrompt: MEETING_OLD, prompt: MEETING_NEW },
  { id: 187, oldPrompt: ORDER_OLD, prompt: ORDER_NEW },
  { id: 188, oldPrompt: ONLINE_OLD, prompt: ONLINE_NEW },
  { id: 194, oldPrompt: MEETING_OLD, prompt: MEETING_NEW },
  { id: 195, oldPrompt: ORDER_OLD, prompt: ORDER_NEW },
  { id: 196, oldPrompt: ONLINE_OLD, prompt: ONLINE_NEW },
  // Set 3, picture tasks: two keywords, both visible in the image.
  { id: 351, oldPrompt: PICTURE_OLD, oldKeywords: ['desk', 'laptop', 'notebook'], prompt: PICTURE_NEW, keywords: ['laptop', 'notebook'] },
  { id: 352, oldPrompt: PICTURE_OLD, oldKeywords: ['room', 'table', 'screen'], prompt: PICTURE_NEW, keywords: ['table', 'screen'] },
  { id: 353, oldPrompt: PICTURE_OLD, oldKeywords: ['worker', 'forklift', 'warehouse'], prompt: PICTURE_NEW, keywords: ['forklift', 'warehouse'] },
  { id: 354, oldPrompt: PICTURE_OLD, oldKeywords: ['receptionist', 'telephone', 'counter'], prompt: PICTURE_NEW, keywords: ['receptionist', 'telephone'] },
  { id: 355, oldPrompt: PICTURE_OLD, oldKeywords: ['colleagues', 'notebook', 'coffee'], prompt: PICTURE_NEW, keywords: ['colleagues', 'coffee'] },
  // Set 3, questions 6-7: a reply to a given e-mail.
  {
    id: 356,
    oldPrompt:
      'Write an email to your office manager requesting a replacement for your broken office chair. Explain why the current chair is unusable and suggest a time when maintenance can deliver the new one.',
    prompt:
      'Read the e-mail from your office manager. Respond to the e-mail: describe one piece of broken equipment, explain how it affects your work, and suggest a time for maintenance to visit.',
    email:
      'From: Daniel Moore, Office Manager\nSubject: Office equipment check\n\nDear team,\nWe are replacing damaged office furniture and equipment next month. If anything at your desk is broken, please reply and tell me what it is and how it affects your work. Maintenance staff can visit desks between 9 a.m. and 4 p.m., Monday to Thursday, so please also tell me when they can come.\nThank you,\nDaniel',
    wordRange: null,
  },
  {
    id: 357,
    oldPrompt:
      'Write an email to the human resources department asking for details about the upcoming leadership training program. Inquire about registration deadlines, required preparation materials, and session locations.',
    prompt:
      'Read the e-mail from the human resources department. Respond to the e-mail as an interested employee: ask TWO questions about the program and give ONE piece of information about your work schedule.',
    email:
      'From: Karen Lee, Human Resources\nSubject: Leadership training program\n\nDear staff,\nWe are pleased to announce a six-week leadership training program starting next month. It is open to employees who have worked here for at least one year. Places are limited, so please reply to this e-mail if you are interested.\nBest regards,\nKaren Lee',
    wordRange: null,
  },
  // Set 3, essay.
  { id: 358, oldPrompt: HOME_OLD, prompt: `${HOME_OLD} Write at least 300 words.`, wordRange: [300, 500] },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`target ${url.hostname}:${url.port}${url.pathname} ${apply ? 'APPLY' : 'DRY RUN'}`);
  const prisma = new PrismaClient();
  const rows: Array<{ fix: Fix; content: Record<string, unknown>; next: Record<string, unknown> }> = [];
  const problems: string[] = [];
  for (const fix of FIXES) {
    const row = await prisma.question.findUnique({ where: { id: fix.id } });
    if (!row) {
      problems.push(`question ${fix.id}: missing`);
      continue;
    }
    const content = (row.content ?? {}) as Record<string, unknown>;
    if (content.prompt !== fix.oldPrompt) problems.push(`question ${fix.id}: prompt changed`);
    if (fix.oldKeywords && JSON.stringify(content.keywords) !== JSON.stringify(fix.oldKeywords))
      problems.push(`question ${fix.id}: keywords changed ${JSON.stringify(content.keywords)}`);
    if (fix.keywords && !fix.keywords.every((k) => fix.oldKeywords?.includes(k)))
      problems.push(`question ${fix.id}: new keyword not among the old ones`);
    const next: Record<string, unknown> = { ...content, prompt: fix.prompt };
    if (fix.keywords) next.keywords = fix.keywords;
    if (fix.email) next.email = fix.email;
    if (fix.wordRange === null) delete next.wordRange;
    else if (fix.wordRange) next.wordRange = fix.wordRange;
    rows.push({ fix, content, next });
  }
  if (problems.length) {
    console.log('ABORT, nothing written:');
    for (const p of problems) console.log('  ', p);
    await prisma.$disconnect();
    process.exit(1);
  }
  for (const { fix, content, next } of rows) {
    const changed = Object.keys({ ...content, ...next }).filter(
      (k) => JSON.stringify(content[k]) !== JSON.stringify(next[k]),
    );
    console.log(`question ${fix.id}: ${changed.join(', ')}`);
  }
  if (!apply) {
    console.log(`DRY RUN ok: ${rows.length} rows checked, nothing written`);
    await prisma.$disconnect();
    return;
  }
  const rollback = `toeic-content-fix-a2-rollback-${Date.now()}.json`;
  writeFileSync(rollback, JSON.stringify(rows.map(({ fix, content }) => ({ id: fix.id, content })), null, 2));
  await prisma.$transaction(
    rows.map(({ fix, next }) => prisma.question.update({ where: { id: fix.id }, data: { content: next as any } })),
  );
  console.log(`APPLIED ${rows.length} rows; rollback file ${rollback}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
