/**
 * TOEIC Writing Q6-7 ("Respond to a written request") referred to an e-mail
 * that was never stored, so the learner had nothing to reply to. This adds
 * the e-mail (as authored in scripts/reconstruct-canonical-toeic.ts) to the
 * existing questions, in both the S&W and 4 Skills writing sets.
 *
 *   plan   read-only: the questions that would change.
 *   apply  writes the original content to .local-backups first, then sets
 *          content.email only where the prompt matches exactly and no e-mail
 *          exists, in one transaction. Needs TOEIC_EMAIL_FIX_AUTHORIZED=apply.
 *
 * --expect 186,187,194,195 refuses to apply unless exactly those questions
 * are the ones to update.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-writing-request-emails.ts plan|apply --target env:DATABASE_URL [--expect ids]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';

const EMAILS: Record<string, string> = {
  'Read the e-mail from a colleague who needs to move a team meeting. Reply in at least 25 words: confirm a new time, suggest a room, and ask one question.':
    "From: Linh Tran\nSubject: Moving Thursday's team meeting\n\nHi, the project room is being repainted on Thursday, so I need to move our 10 a.m. team meeting. Could you tell me a time on Friday that works for you and which room we could use instead? Thanks, Linh",
  'A customer writes that part of their order is missing. Reply in at least 25 words: apologise, explain the next step, and request one piece of information.':
    'From: Mark Davis\nSubject: Missing item in order #4821\n\nHello, my order arrived yesterday, but the desk lamp was not in the box. The other items were in good condition. Please let me know what you will do about the missing lamp. Regards, Mark Davis',
};

async function main() {
  const [mode, , target, , expectArg] = process.argv.slice(2);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url) throw new Error('--target env:DATABASE_URL | <url> is required');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const rows = await prisma.question.findMany({
    where: {
      quiz: { toeicWritingSetItems: { some: {} } },
      content: { path: ['taskType'], equals: 'WRITTEN_REQUEST' },
    },
    select: { id: true, quizId: true, content: true },
    orderBy: { id: 'asc' },
  });
  const targets = rows.filter((r) => {
    const c = r.content as Record<string, unknown>;
    return typeof c.prompt === 'string' && EMAILS[c.prompt] && !c.email;
  });
  console.log(
    `written-request questions: ${rows.length}; to update: ${targets.map((t) => `${t.id} (quiz ${t.quizId})`).join(', ') || 'none'}`,
  );
  if (mode !== 'apply') return prisma.$disconnect();
  if (
    expectArg &&
    targets.map((t) => t.id).join(',') !==
      expectArg
        .split(',')
        .map(Number)
        .sort((a, b) => a - b)
        .join(',')
  )
    throw new Error(
      `STOP: targets ${targets.map((t) => t.id).join(',')} differ from --expect ${expectArg}`,
    );
  if (process.env.TOEIC_EMAIL_FIX_AUTHORIZED !== 'apply')
    throw new Error('REFUSED: TOEIC_EMAIL_FIX_AUTHORIZED=apply not set');
  const dir = join(
    __dirname,
    '..',
    '..',
    '..',
    '.local-backups',
    'breadtrans-auto',
  );
  mkdirSync(dir, { recursive: true });
  const file = join(
    dir,
    `Question_PRE_TOEIC_REQUEST_EMAIL_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(file, JSON.stringify(targets, null, 2));
  console.log(`backup: ${file}`);
  await prisma.$transaction(async (tx) => {
    for (const t of targets) {
      const c = t.content as Record<string, unknown>;
      const changed = await tx.question.updateMany({
        where: { id: t.id, quizId: t.quizId },
        data: {
          content: {
            ...c,
            email: EMAILS[c.prompt as string],
          },
        },
      });
      if (changed.count !== 1) throw new Error(`question ${t.id} not updated`);
    }
  });
  console.log(`updated: ${targets.length}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('STOPPED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
