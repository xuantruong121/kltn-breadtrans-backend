/**
 * TOEIC fix batch C (owner approved 2026-11-06): writes the hand-written
 * groups of toeic-content-fix-c-2026-11-06.data.ts into exams 1 and 3.
 *
 * Modes:
 *   check    read-only: content rules (lengths, speakers, graphic questions,
 *            question numbers, keys) and the DB guards for every group.
 *   render   draws each graphic as a PNG under artifacts/toeic-fix-c/ with
 *            the local Playwright Chromium; no network.
 *   upload   puts each PNG in the public R2 bucket under a content-hashed key,
 *            refusing to overwrite a different object.
 *            Needs TOEIC_FIX_C_UPLOAD_AUTHORIZED=upload.
 *   apply    one transaction per run: group script/passage/image and the
 *            questions' text, options, key and explanation, after saving
 *            the old rows to a rollback file. Graphic groups need their PNG
 *            uploaded first. Audio is regenerated afterwards by
 *            materialize-exam1-listening-phase0.ts --exam=<id>.
 *
 * Usage: npx ts-node --transpile-only scripts/toeic-content-fix-c-2026-11-06.ts <mode> [--exam 1|3]
 * Target: DATABASE_URL (an explicit environment variable overrides .env).
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

import { buildToeicListeningAudioScript } from '../src/modules/toeic/toeic-listening-audio';
import { listeningScriptLengthIssue } from '../src/modules/toeic/toeic-listening-length';
import { C_GROUPS, type CGraphic, type CGroup } from './toeic-content-fix-c-2026-11-06.data';

const OUT = 'artifacts/toeic-fix-c';
const mode = process.argv[2];
const examArg = process.argv.includes('--exam') ? Number(process.argv[process.argv.indexOf('--exam') + 1]) : null;
const groups = C_GROUPS.filter((g) => examArg === null || g.examId === examArg);

const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const pngFile = (g: CGroup) => join(OUT, `exam-${g.examId}-group-${g.groupId}.png`);
const pngKey = (g: CGroup, body: Buffer) =>
  `catalog/toeic/exam-${g.examId}/graphics/${g.groupId}-${sha(body).slice(0, 12)}.png`;
const publicBase = () => (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');

/** Content rules that need no database. */
function contentProblems(g: CGroup): string[] {
  const p: string[] = [];
  const tag = `exam ${g.examId} group ${g.groupId}`;
  if (g.part === 3 || g.part === 4) {
    const issue = listeningScriptLengthIssue(g.part, g.transcript);
    if (issue) p.push(`${tag}: ${issue}`);
    try {
      buildToeicListeningAudioScript({ part: g.part, transcriptText: g.transcript, questions: g.questions.map((q) => ({ text: q.text, questionNumber: q.n, options: q.options, correctIndex: q.key })) } as any);
    } catch (e) {
      p.push(`${tag}: audio script ${(e as Error).message}`);
    }
    const labels = new Set([...(g.transcript ?? '').matchAll(/^([A-Z][A-Za-z]*\d?):/gm)].map((m) => m[1]));
    if (g.part === 3 && g.kind === 'THREE_SPEAKERS' && labels.size !== 3) p.push(`${tag}: ${labels.size} speakers`);
    if (g.part === 3 && g.kind === 'GRAPHIC' && labels.size !== 2) p.push(`${tag}: ${labels.size} speakers`);
    if (g.part === 3 && !/^W/.test(g.transcript ?? '')) p.push(`${tag}: dialogue must open with a woman (voice order)`);
    if (g.part === 4 && labels.size) p.push(`${tag}: a talk has no speaker labels`);
  }
  if (g.kind === 'GRAPHIC') {
    if (!g.graphic) p.push(`${tag}: graphic missing`);
    if (g.questions.filter((q) => q.text.startsWith('Look at the graphic.')).length !== 1)
      p.push(`${tag}: needs exactly one "Look at the graphic." question`);
  }
  if (g.kind === 'THREE_SPEAKERS' && !g.questions.some((q) => /say(s)?, "/.test(q.text)))
    p.push(`${tag}: no implied-meaning question`);
  if (g.part === 7) {
    const docs = (g.passage ?? '').match(/^DOCUMENT \d — /gm)?.length ?? 0;
    if (docs !== (g.kind === 'DOUBLE' ? 2 : 3)) p.push(`${tag}: ${docs} documents for ${g.kind}`);
  }
  for (const q of g.questions) {
    if (new Set(q.options).size !== 4) p.push(`${tag} q${q.n}: options not distinct`);
    if (!q.explanation.trim()) p.push(`${tag} q${q.n}: no explanation`);
  }
  return p;
}

async function dbRows(prisma: PrismaClient, g: CGroup) {
  return prisma.toeicQuestionGroup.findUnique({
    where: { id: g.groupId },
    include: { questions: { orderBy: { questionNumber: 'asc' } } },
  });
}

function dbProblems(g: CGroup, row: Awaited<ReturnType<typeof dbRows>>): string[] {
  const tag = `exam ${g.examId} group ${g.groupId}`;
  if (!row) return [`${tag}: missing`];
  const p: string[] = [];
  if (row.examId !== g.examId || row.part !== g.part) p.push(`${tag}: exam/part ${row.examId}/${row.part}`);
  const have = row.questions.map((q) => q.questionNumber).join(',');
  const want = g.questions.map((q) => q.n).join(',');
  if (have !== want) p.push(`${tag}: questions ${have} != ${want}`);
  return p;
}

function graphicHtml(graphic: CGraphic) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const head = graphic.columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = graphic.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#000}
#card{display:inline-block;padding:20px 24px;border:2px solid #000;background:#fff}
h1{font-size:20px;margin:0 0 12px;text-align:center}
table{border-collapse:collapse;font-size:18px;min-width:420px}
th,td{border:1px solid #000;padding:8px 14px;text-align:left}
th{background:#e6e6e6;font-weight:bold}
</style></head><body><div id="card"><h1>${esc(graphic.title)}</h1><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></body></html>`;
}

async function main() {
  if (!['check', 'render', 'upload', 'apply'].includes(mode)) throw new Error('mode: check | render | upload | apply');
  const url = new URL(process.env.DATABASE_URL ?? '');
  console.log(`${mode} target ${url.hostname}:${url.port}${url.pathname} groups ${groups.length}`);

  if (mode === 'render') {
    mkdirSync(OUT, { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    for (const g of groups.filter((x) => x.graphic)) {
      await page.setContent(graphicHtml(g.graphic!));
      const buf: Buffer = await page.locator('#card').screenshot();
      writeFileSync(pngFile(g), buf);
      console.log(`${pngFile(g)} ${buf.length} bytes`);
    }
    await browser.close();
    return;
  }

  if (mode === 'upload') {
    if (process.env.TOEIC_FIX_C_UPLOAD_AUTHORIZED !== 'upload') throw new Error('REFUSED: TOEIC_FIX_C_UPLOAD_AUTHORIZED=upload not set');
    const client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    });
    const bucket = process.env.R2_BUCKET_NAME!;
    for (const g of groups.filter((x) => x.graphic)) {
      const body = readFileSync(pngFile(g));
      const key = pngKey(g, body);
      const md5 = createHash('md5').update(body).digest('hex');
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).catch((e: any) => {
        if (e?.$metadata?.httpStatusCode === 404) return null;
        throw e;
      });
      if (head && (head.ETag ?? '').replace(/"/g, '') !== md5) throw new Error(`REFUSED: ${key} exists with different content`);
      if (!head) await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'image/png' }));
      console.log(`${key}: ${head ? 'exists' : 'uploaded'}`);
    }
    return;
  }

  const prisma = new PrismaClient();
  const problems: string[] = [];
  const rows: Array<{ g: CGroup; row: NonNullable<Awaited<ReturnType<typeof dbRows>>> }> = [];
  for (const g of groups) {
    problems.push(...contentProblems(g));
    const row = await dbRows(prisma, g);
    problems.push(...dbProblems(g, row));
    if (row) rows.push({ g, row });
    if (mode === 'apply' && g.graphic && !existsSync(pngFile(g))) problems.push(`group ${g.groupId}: PNG not rendered`);
  }
  const keys = groups.flatMap((g) => g.questions.map((q) => q.key));
  console.log(`keys A/B/C/D: ${[0, 1, 2, 3].map((k) => keys.filter((x) => x === k).length).join('/')}`);
  for (const g of groups)
    if (g.transcript) console.log(`exam ${g.examId} group ${g.groupId} part ${g.part} ${g.kind}: ${listeningScriptLengthIssue(g.part, g.transcript) ?? 'length ok'}`);
    else console.log(`exam ${g.examId} group ${g.groupId} part ${g.part} ${g.kind}: ${g.passage!.split(/\s+/).length} words`);
  if (problems.length) {
    console.log('ABORT, nothing written:');
    for (const p of problems) console.log('  ', p);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (mode === 'check') {
    console.log(`CHECK ok: ${groups.length} groups, ${keys.length} questions, nothing written`);
    await prisma.$disconnect();
    return;
  }

  const rollback = `toeic-content-fix-c-rollback-${examArg ?? 'all'}-${Date.now()}.json`;
  writeFileSync(rollback, JSON.stringify(rows.map(({ row }) => row), null, 2));
  const ops = rows.flatMap(({ g, row }) => {
    const imageUrl = g.graphic ? `${publicBase()}/${pngKey(g, readFileSync(pngFile(g)))}` : null;
    const groupData: Record<string, unknown> =
      g.part === 7
        ? { passageText: g.passage }
        : {
            transcriptText: g.transcript,
            imageUrl,
            imageBrief: g.graphic ? `Graphic: ${g.graphic.title}` : null,
          };
    return [
      prisma.toeicQuestionGroup.update({ where: { id: row.id }, data: groupData }),
      ...g.questions.map((q) => {
        const old = row.questions.find((x) => x.questionNumber === q.n)!;
        return prisma.toeicQuestion.update({
          where: { id: old.id },
          data: { text: q.text, options: q.options, correctIndex: q.key, explanation: q.explanation },
        });
      }),
    ];
  });
  await prisma.$transaction(ops);
  console.log(`APPLIED ${rows.length} groups (${ops.length} rows); rollback file ${rollback}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
