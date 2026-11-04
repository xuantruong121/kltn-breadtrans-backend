/**
 * Rewrites the Part 3 dialogues of the given exam sets with one speaker turn
 * per line (splitSpeakerTurns), so their audio can be rebuilt with one voice
 * per speaker. Every word is kept: a group whose words would change is
 * refused. Run materialize-exam1-listening-phase0.ts afterwards; the changed
 * transcript changes the audio fingerprint, so only these groups are rebuilt.
 *
 * Dry run unless --apply. Prints the database it targets.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/normalize-part3-transcripts.ts --exam=1,3
 *   npx ts-node --transpile-only scripts/normalize-part3-transcripts.ts --exam=1,3 --apply
 */
import { PrismaClient } from '@prisma/client';

import { splitSpeakerTurns } from '../src/modules/toeic/toeic-listening-audio';

const examArg = process.argv.find((value) => value.startsWith('--exam='));
const examIds = (examArg?.split('=')[1] ?? '')
  .split(',')
  .map(Number)
  .filter((id) => Number.isInteger(id) && id > 0);
const apply = process.argv.includes('--apply');
if (!examIds.length) throw new Error('usage: --exam=1,3 [--apply]');

const words = (text: string) => text.replace(/\s+/g, ' ').trim();

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(
    `target ${url.hostname}:${url.port}${url.pathname} exams ${examIds.join(',')}${apply ? ' [APPLY]' : ' [DRY RUN]'}`,
  );
  const prisma = new PrismaClient();
  try {
    const groups = await prisma.toeicQuestionGroup.findMany({
      where: { examId: { in: examIds }, part: 3 },
      select: {
        id: true,
        examId: true,
        groupOrder: true,
        transcriptText: true,
      },
      orderBy: [{ examId: 'asc' }, { groupOrder: 'asc' }],
    });
    let changed = 0;
    for (const group of groups) {
      const before = group.transcriptText ?? '';
      const after = splitSpeakerTurns(before);
      if (after === before) continue;
      if (words(after) !== words(before))
        throw new Error(`group ${group.id}: the split would change its words`);
      changed += 1;
      console.log(
        `exam ${group.examId} group ${group.id}: ${before.split('\n').length} -> ${after.split('\n').length} lines`,
      );
      if (apply)
        await prisma.toeicQuestionGroup.update({
          where: { id: group.id },
          data: { transcriptText: after },
        });
    }
    console.log(
      `${groups.length} Part 3 groups, ${changed} ${apply ? 'rewritten' : 'to rewrite'}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
