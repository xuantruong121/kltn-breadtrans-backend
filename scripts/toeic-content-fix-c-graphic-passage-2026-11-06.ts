/**
 * Correction to batch C (2026-11-06): the ten graphic groups stored their
 * table only as a PNG (imageUrl) and left passageText empty. The system's own
 * convention (toeic-exam-prompt.ts GRAPHIC_RULE, isListeningGraphic) is a
 * passageText of "GRAPHIC: <title>" followed by " | " rows: the exam paper
 * draws it as a table (ToeicGraphic), the answer reviewer reads it, and
 * questionContentIssue rejects a "Look at the graphic" question without it.
 *
 * This writes that passageText and clears imageUrl, so the table is not shown
 * twice. Audio is untouched: Part 3/4 audio is built from transcriptText.
 *
 * Dry run by default; --apply writes in one transaction after saving the old
 * rows to a rollback file.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-content-fix-c-graphic-passage-2026-11-06.ts [--apply]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import {
  isListeningGraphic,
  questionContentIssue,
} from '../src/modules/toeic/toeic-ai-batch.logic';
import { C_GROUPS } from './toeic-content-fix-c-2026-11-06.data';

export const graphicPassage = (g: {
  title: string;
  columns: string[];
  rows: string[][];
}) =>
  [`GRAPHIC: ${g.title}`, g.columns.join(' | '), ...g.rows.map((r) => r.join(' | '))].join('\n');

async function main() {
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`target ${url.hostname}:${url.port}${url.pathname} ${apply ? 'APPLY' : 'DRY RUN'}`);
  const prisma = new PrismaClient();
  const problems: string[] = [];
  const rows: Array<{ id: number; passage: string; old: unknown }> = [];
  for (const g of C_GROUPS.filter((x) => x.graphic)) {
    const row = await prisma.toeicQuestionGroup.findUnique({
      where: { id: g.groupId },
      include: { questions: { orderBy: { questionNumber: 'asc' } } },
    });
    if (!row) { problems.push(`group ${g.groupId}: missing`); continue; }
    if (!String(row.imageUrl ?? '').includes(`/graphics/${g.groupId}-`)) problems.push(`group ${g.groupId}: imageUrl changed`);
    if (row.passageText) problems.push(`group ${g.groupId}: passageText already set`);
    const passage = graphicPassage(g.graphic!);
    if (!isListeningGraphic(passage)) problems.push(`group ${g.groupId}: not a GRAPHIC passage`);
    const issue = questionContentIssue(row.part, {
      transcript: row.transcriptText,
      passageText: passage,
      questions: row.questions.map((q) => ({ text: q.text })),
    } as any);
    if (issue) problems.push(`group ${g.groupId}: ${issue}`);
    rows.push({ id: row.id, passage, old: { id: row.id, imageUrl: row.imageUrl, passageText: row.passageText } });
    console.log(`group ${g.groupId}: ${passage.split('\n').length - 1} rows, "${g.graphic!.title}"`);
  }
  if (problems.length) {
    console.log('ABORT, nothing written:');
    for (const p of problems) console.log('  ', p);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!apply) {
    console.log(`DRY RUN ok: ${rows.length} groups, nothing written`);
    await prisma.$disconnect();
    return;
  }
  const file = `toeic-content-fix-c-graphic-rollback-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(rows.map((r) => r.old), null, 2));
  await prisma.$transaction(
    rows.map((r) =>
      prisma.toeicQuestionGroup.update({ where: { id: r.id }, data: { passageText: r.passage, imageUrl: null } }),
    ),
  );
  console.log(`APPLIED ${rows.length} groups; rollback file ${file}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
