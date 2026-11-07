/**
 * Read-only structural audit of the three published TOEIC tests:
 *   L&R Đề 01 (exam 1), S&W Đề 01 (assessment 1: exam-3-speaking + Writing
 *   set 1), 4 Skills Đề 02 (assessment 3: exam 3 + exam-5-speaking + Writing
 *   set 3). Practice by Part uses the same L&R groups, so it is covered here.
 *
 * Checks what a script can decide; it does not judge whether a key is right
 * (that needs a reader or a solver). Public media are fetched with HEAD only;
 * private Listening audio is checked by key presence and by the stored
 * sourceHash against the current audio fingerprint (stale-audio check).
 * Prints FLAG=value lines and every finding. Never writes.
 *
 * Usage: npx ts-node --transpile-only scripts/qa/toeic-published-content-audit.ts
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import {
  explanationNamesPosition,
  isListeningGraphic,
  isVietnameseExplanation,
  languageIssue,
  questionContentIssue,
  readingGroupIssue,
} from '../../src/modules/toeic/toeic-ai-batch.logic';
import { toeicListeningAudioFingerprint } from '../../src/modules/toeic/toeic-listening-audio';
import { listeningScriptLengthIssue } from '../../src/modules/toeic/toeic-listening-length';
import { listeningMasterFor } from '../../src/modules/toeic/toeic-listening-master';
import { speakerGender } from '../../src/modules/ai/listening-voices';
import { TOEIC_WRITING_SLOT_CONTRACT } from '../../src/modules/writing/toeic-writing-set.contract';

const PART_COUNTS: Record<number, number> = { 1: 6, 2: 25, 3: 39, 4: 30, 5: 30, 6: 16, 7: 54 };
const SPEAKING_ORDER = [
  'READ_ALOUD', 'READ_ALOUD', 'DESCRIBE_PICTURE', 'DESCRIBE_PICTURE',
  'RESPOND_TO_QUESTION', 'RESPOND_TO_QUESTION', 'RESPOND_TO_QUESTION',
  'RESPOND_USING_INFORMATION', 'RESPOND_USING_INFORMATION', 'RESPOND_USING_INFORMATION',
  'EXPRESS_OPINION',
];
const findings: string[] = [];
const flags: Record<string, string> = {};
const note = (s: string) => findings.push(s);
const LETTER = 'ABCD';

async function head(url: string | null | undefined) {
  if (!url) return 'MISSING';
  if (!/^https?:/.test(url)) return 'PRIVATE_KEY';
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
    return String(r.status);
  } catch {
    return 'NETWORK';
  }
}

async function auditExam(prisma: PrismaClient, examId: number) {
  const tag = `exam${examId}`;
  const groups = await prisma.toeicQuestionGroup.findMany({
    where: { examId },
    orderBy: [{ part: 'asc' }, { groupOrder: 'asc' }],
    include: { questions: { orderBy: { questionNumber: 'asc' } } },
  });
  const numbers = groups.flatMap((g) => g.questions.map((q) => q.questionNumber));
  const seqOk = JSON.stringify(numbers) === JSON.stringify(Array.from({ length: 200 }, (_, i) => i + 1));
  flags[`${tag.toUpperCase()}_NUMBERING_1_200`] = seqOk ? 'PASS' : 'FAIL';
  if (!seqOk) note(`${tag}: question numbers are not 1..200 in order`);
  for (const [part, want] of Object.entries(PART_COUNTS)) {
    const have = groups.filter((g) => g.part === Number(part)).reduce((n, g) => n + g.questions.length, 0);
    if (have !== want) note(`${tag} Part ${part}: ${have} questions, expected ${want}`);
  }
  const keys: Record<number, number[]> = {};
  let stale = 0;
  let listening = 0;
  const people = new Map<string, Set<number>>();
  for (const g of groups) {
    const gt = `${tag} P${g.part} g${g.id} (q${g.questions[0]?.questionNumber}-${g.questions.at(-1)?.questionNumber})`;
    const batchGroup = {
      transcript: g.transcriptText,
      passageText: g.passageText,
      imageBrief: g.imageBrief,
      questions: g.questions.map((q) => ({ text: q.text, options: q.options as string[], correctIndex: q.correctIndex, explanation: q.explanation })),
    } as any;
    for (const issue of [
      questionContentIssue(g.part, batchGroup),
      g.part >= 5 ? readingGroupIssue(g.part, batchGroup) : null,
      languageIssue(batchGroup),
      g.part === 3 || g.part === 4 ? listeningScriptLengthIssue(g.part, g.transcriptText) : null,
    ])
      if (issue) note(`${gt}: ${issue}`);
    if (g.part <= 4) {
      listening += 1;
      if (!g.audioUrl) note(`${gt}: no audio`);
      try {
        const fp = toeicListeningAudioFingerprint({ ...g, transcriptText: g.transcriptText, questions: g.questions } as any);
        const stored = (g.mediaMetadata as any)?.audio?.sourceHash;
        if (stored !== fp) { stale += 1; note(`${gt}: audio made from an older script (sourceHash differs)`); }
      } catch (e) {
        note(`${gt}: audio script cannot be built: ${(e as Error).message}`);
      }
    }
    if (g.part === 1) {
      const s = await head(g.imageUrl);
      if (s !== '200') note(`${gt}: Part 1 image ${s}`);
    }
    if (g.part === 3) {
      const labels = [...new Set([...(g.transcriptText ?? '').matchAll(/(?:^|[.!?]\s+)([A-Z][A-Za-z]{0,11}(?: ?\d)?):\s/gm)].map((m) => m[1]))];
      const unknown = labels.filter((l) => !speakerGender(l));
      if (unknown.length) note(`${gt}: speaker labels without a gender: ${unknown.join(', ')}`);
    }
    if ((g.part === 3 || g.part === 4) && g.imageUrl && !isListeningGraphic(g.passageText))
      note(`${gt}: listening group has an image but no GRAPHIC passage`);
    if (g.part === 7) {
      const docs = (g.passageText ?? '').match(/^DOCUMENT\s+\d+/gim)?.length ?? 0;
      const n = g.questions.length;
      const first = g.questions[0]?.questionNumber ?? 0;
      if (first >= 176 && first < 186 && docs !== 2) note(`${gt}: ${docs} documents, a double set expected at 176-185`);
      if (first >= 186 && docs !== 3) note(`${gt}: ${docs} documents, a triple set expected at 186-200`);
      if (first < 176 && docs > 1) note(`${gt}: ${docs} documents in the single-passage range`);
      if (first >= 176 && n !== 5) note(`${gt}: ${n} questions in a multi-passage set`);
    }
    for (const m of `${g.transcriptText ?? ''} ${g.passageText ?? ''}`.matchAll(/\b(?:Mr\.|Ms\.|Mrs\.|Dr\.)\s+([A-Z][a-z]+)|\b([A-Z][a-z]+ [A-Z][a-z]{2,})\b(?= (?:from|at|of|here|and|is|will|has|said|called|calling))/g)) {
      const name = m[1] ?? m[2];
      if (!people.has(name)) people.set(name, new Set());
      people.get(name)!.add(g.id);
    }
    for (const q of g.questions) {
      const qt = `${tag} q${q.questionNumber}`;
      const opts = q.options as string[];
      const want = g.part === 2 ? 3 : 4;
      if (!Array.isArray(opts) || opts.length !== want) note(`${qt}: ${opts?.length} options, expected ${want}`);
      else if (new Set(opts.map((o) => o.trim().toLowerCase())).size !== opts.length) note(`${qt}: duplicate options`);
      else if (opts.some((o) => !o.trim())) note(`${qt}: empty option`);
      if (!(q.correctIndex >= 0 && q.correctIndex < want)) note(`${qt}: key ${q.correctIndex} out of range`);
      (keys[g.part] ??= []).push(q.correctIndex);
      if (!q.explanation?.trim()) note(`${qt}: no explanation`);
      else {
        if (!isVietnameseExplanation(q.explanation)) note(`${qt}: explanation not Vietnamese`);
        if (explanationNamesPosition(q.explanation)) note(`${qt}: explanation names an option position`);
        const letter = /đáp án\s*(?:đúng\s*)?(?:là\s*)?\(?([A-D])\)?(?=[\s.,:)])/i.exec(q.explanation)?.[1];
        if (letter && LETTER.indexOf(letter.toUpperCase()) !== q.correctIndex)
          note(`${qt}: explanation says answer ${letter}, key is ${LETTER[q.correctIndex]}`);
      }
      if (g.part >= 3 && !q.text?.trim()) note(`${qt}: no question text`);
    }
  }
  const dist = Object.entries(keys).map(([p, ks]) => `P${p} ${[0, 1, 2, 3].map((k) => ks.filter((x) => x === k).length).join('/')}`);
  flags[`${tag.toUpperCase()}_KEY_SPREAD`] = dist.join('; ');
  flags[`${tag.toUpperCase()}_STALE_AUDIO`] = `${stale} of ${listening}`;
  for (const [name, ids] of people) if (ids.size >= 3) note(`${tag}: name "${name}" appears in ${ids.size} groups`);

  // Listening master: same groups in the same order, built from today's clips.
  const master = listeningMasterFor(examId);
  const listeningIds = groups.filter((g) => g.part <= 4).map((g) => g.id);
  const masterIds = master?.timeline.filter((s) => s.kind === 'GROUP').map((s) => s.groupId) ?? [];
  flags[`${tag.toUpperCase()}_MASTER_ORDER`] = JSON.stringify(masterIds) === JSON.stringify(listeningIds) ? 'PASS' : 'FAIL';
  try {
    const inv = JSON.parse(readFileSync(`artifacts/toeic-listening-master/exam-${examId}/inventory.json`, 'utf8'));
    const tl = JSON.parse(readFileSync(`artifacts/toeic-listening-master/exam-${examId}/timeline.json`, 'utf8'));
    const byId = new Map(groups.map((g) => [g.id, g.audioUrl]));
    const stale = (inv.clips ?? []).filter((c: any) => byId.get(c.groupId) !== c.audioUrl).map((c: any) => c.groupId);
    const sameMaster = tl.sha256 === master?.sha256;
    flags[`${tag.toUpperCase()}_MASTER_CLIPS_CURRENT`] = !stale.length && sameMaster ? 'PASS' : 'FAIL';
    if (stale.length) note(`${tag}: master built from older clips of groups ${stale.join(',')}`);
    if (!sameMaster) note(`${tag}: registry sha differs from the built timeline`);
  } catch (e) {
    flags[`${tag.toUpperCase()}_MASTER_CLIPS_CURRENT`] = 'NOT_VERIFIED';
    note(`${tag}: master inventory not readable: ${(e as Error).message}`);
  }
}

async function auditSpeaking(prisma: PrismaClient, setId: string) {
  const rows = await prisma.speakingExercise.findMany({
    where: { practiceSetId: setId },
    orderBy: { order: 'asc' },
    include: { stimulus: true } as any,
  });
  const types = rows.map((r) => r.taskType);
  flags[`SPEAKING_${setId}_ORDER`] = JSON.stringify(types) === JSON.stringify(SPEAKING_ORDER) ? 'PASS' : 'FAIL';
  if (flags[`SPEAKING_${setId}_ORDER`] === 'FAIL') note(`${setId}: task order ${types.join(',')}`);
  for (const r of rows) {
    const t = `${setId} Q${r.order}`;
    if (!r.targetText?.trim()) note(`${t}: no text`);
    if (r.taskType === 'DESCRIBE_PICTURE') {
      const s = await head(r.imageUrl);
      if (s !== '200') note(`${t}: picture ${s}`);
    }
    if (['RESPOND_TO_QUESTION', 'RESPOND_USING_INFORMATION', 'EXPRESS_OPINION'].includes(r.taskType as string)) {
      const s = await head(r.audioUrl);
      if (s !== '200') note(`${t}: prompt audio ${s}`);
    }
    if (r.taskType === 'RESPOND_USING_INFORMATION' && !(r as any).stimulus) note(`${t}: no information stimulus`);
    if (r.publicationStatus !== 'PUBLISHED') note(`${t}: ${r.publicationStatus}`);
  }
  const q57 = rows.filter((r) => r.taskType === 'RESPOND_TO_QUESTION');
  if (q57.length === 3 && !/telephone interview|imagine/i.test(q57[0].targetText)) note(`${setId} Q5: no shared-topic introduction`);
}

async function auditWriting(prisma: PrismaClient, setId: number) {
  const items = await prisma.toeicWritingSetItem.findMany({
    where: { writingSetId: setId },
    orderBy: { order: "asc" },
  });
  if (items.length !== 8) note(`writing set ${setId}: ${items.length} items`);
  for (const [i, item] of items.entries()) {
    const quizId = item.writingQuizId;
    const q = await prisma.question.findFirst({ where: { quizId } });
    const c = (q?.content ?? {}) as any;
    const t = `writing set ${setId} Q${i + 1} (quiz ${quizId})`;
    const kind = TOEIC_WRITING_SLOT_CONTRACT[i];
    if (c.taskType !== kind) note(`${t}: taskType ${c.taskType}, slot ${kind}`);
    if (kind === 'PICTURE_SENTENCE') {
      const kw = Array.isArray(c.keywords) ? c.keywords : [];
      if (kw.length !== 2) note(`${t}: ${kw.length} keywords`);
      const s = await head(c.imageUrl);
      if (s !== '200') note(`${t}: picture ${s}`);
    }
    if (kind === 'WRITTEN_REQUEST' && String(c.email ?? '').trim().length < 40) note(`${t}: no e-mail to answer`);
    if (kind === 'OPINION_ESSAY' && !/300 words/.test(String(c.prompt))) note(`${t}: essay prompt lacks the 300-word floor`);
    if (/at least \d+ words/.test(String(c.prompt)) && kind === 'WRITTEN_REQUEST') note(`${t}: e-mail task states a word floor`);
  }
}

async function main() {
  const prisma = new PrismaClient();
  await auditExam(prisma, 1);
  await auditExam(prisma, 3);
  await auditSpeaking(prisma, 'exam-3-speaking');
  await auditSpeaking(prisma, 'exam-5-speaking');
  const sets = await prisma.toeicAssessmentComponent.findMany({
    where: { assessmentId: { in: [1, 3] }, kind: 'WRITING' } as any,
  });
  for (const s of sets) await auditWriting(prisma, (s as any).writingSetId);
  console.log('```');
  for (const [k, v] of Object.entries(flags)) console.log(`${k}=${v}`);
  console.log(`FINDINGS=${findings.length}`);
  console.log('```');
  for (const f of findings) console.log(`- ${f}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
