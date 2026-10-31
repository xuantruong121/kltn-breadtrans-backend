/**
 * Repairs the 48 F8 skill practice drafts (owner review 2026-10-30: "sau câu 1
 * không có nội dung, không có audio, lấy gì mà nghe"). An audit against the
 * published content found:
 *   Listening  dialogue kept in a separate DIALOGUE question (empty prompt in
 *              the CMS); MCQs without transcriptSegments/audioText/accent/
 *              level/skill; turn translations in Spanish; explanations in
 *              English; no quiz metadata (levels, topics, accents, duration)
 *   Reading    explanations in English; no level/skill; no quiz metadata
 *   Writing    no rubric (the grader then has no criteria), no requirements,
 *              no sample response; prompt in English
 *   Speaking   no reference audio (published exercises all have it)
 *
 * Modes (artifacts/skill-practice-v1/):
 *   repair     Gemini, one request per Listening/Reading/Writing item, for
 *              the Vietnamese and grading fields only (repairs.json).
 *              Needs SKILL_PRACTICE_GEMINI_AUTHORIZED=generate.
 *   normalize  rewrites the DRAFT items on --target in the published shape
 *              (rollback file first). A non-harness target needs
 *              SKILL_PRACTICE_APPLY_AUTHORIZED=apply. Refuses an item that is
 *              no longer DRAFT.
 * Audio is made afterwards with the existing tools (Listening artifact
 * preview, scripts/speaking-reference-audio.ts).
 *
 * Usage: npx ts-node --transpile-only scripts/skill-practice-repair.ts <mode> [--target <url|env:DATABASE_URL>]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SchemaType } from '@google/generative-ai';
import { PrismaClient, type Prisma } from '@prisma/client';

import { GeminiEvaluatorStrategy } from '../src/modules/ai/strategies/gemini-evaluator.strategy';
import { buildSpec } from './generate-skill-practice';

const DIR = join('artifacts', 'skill-practice-v1');
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const VI = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

/** Rubric of the published email/short-writing tasks (practice-writing-grading). */
const WRITING_RUBRIC = {
  grammar: 2,
  vocabulary: 2,
  organization: 2,
  taskAchievement: 4,
};

type Drafts = Record<string, any>;
type Repairs = Record<string, any>;

const str = { type: SchemaType.STRING } as const;
const strArray = { type: SchemaType.ARRAY, items: str } as const;
const SCHEMA: Record<string, any> = {
  LISTENING: {
    type: SchemaType.OBJECT,
    properties: {
      translations: strArray,
      explanations: strArray,
      evidence: strArray,
      topics: strArray,
    },
    required: ['translations', 'explanations', 'evidence', 'topics'],
  },
  READING: {
    type: SchemaType.OBJECT,
    properties: { explanations: strArray, passageTypes: strArray },
    required: ['explanations', 'passageTypes'],
  },
  WRITING: {
    type: SchemaType.OBJECT,
    properties: {
      promptVi: str,
      requirements: strArray,
      sampleResponse: str,
    },
    required: ['promptVi', 'requirements', 'sampleResponse'],
  },
};

function prompt(skill: string, cefr: string, d: any): string {
  if (skill === 'LISTENING')
    return `You review an English listening exercise for Vietnamese learners (level ${cefr}).
Dialogue turns, in order:
${(d.turns ?? []).map((t: any, i: number) => `${i + 1}. ${t.speaker}: ${t.text}`).join('\n')}
Questions:
${(d.questions ?? []).map((q: any, i: number) => `${i + 1}. ${q.prompt} | options: ${q.options.join(' / ')} | correct: ${q.options[q.correctIndex]}`).join('\n')}
Return JSON:
- translations: one natural Vietnamese translation per dialogue turn, same order, exactly ${(d.turns ?? []).length} items;
- explanations: one short Vietnamese explanation per question (why the correct option is right, quoting the dialogue idea), exactly ${(d.questions ?? []).length} items, never naming an option letter;
- evidence: for each question, the exact English sentence from the dialogue that proves the answer, exactly ${(d.questions ?? []).length} items;
- topics: 2 short Vietnamese topic labels (e.g. "Công việc", "Dịch vụ").`;
  if (skill === 'READING')
    return `You review an English reading exercise for Vietnamese learners (level ${cefr}).
Passage:
${d.passage}
Questions:
${(d.questions ?? []).map((q: any, i: number) => `${i + 1}. ${q.prompt} | options: ${q.options.join(' / ')} | correct: ${q.options[q.correctIndex]}`).join('\n')}
Return JSON:
- explanations: one short Vietnamese explanation per question citing the passage, exactly ${(d.questions ?? []).length} items, never naming an option letter;
- passageTypes: 1-3 short English labels for the text type (e.g. "email", "notice", "article").`;
  return `You prepare an English writing task for Vietnamese learners (level ${cefr}).
Task (English): ${d.prompt}
Word range: ${(d.wordRange ?? []).join('-')}
Return JSON:
- promptVi: the task instruction in Vietnamese, as a teacher would write it, stating the word range (e.g. "Viết email 100–130 từ cho ...");
- requirements: 3-4 short English content points the answer must cover;
- sampleResponse: a model answer in English at level ${cefr}, inside the word range, covering every requirement.`;
}

function check(skill: string, d: any, r: any): string | null {
  if (skill === 'LISTENING') {
    if (r.translations?.length !== (d.turns ?? []).length)
      return 'translations count';
    if (r.translations.some((t: string) => !VI.test(t)))
      return 'translation not Vietnamese';
    if (r.explanations?.length !== d.questions.length)
      return 'explanations count';
    if (r.evidence?.length !== d.questions.length) return 'evidence count';
  } else if (skill === 'READING') {
    if (r.explanations?.length !== d.questions.length)
      return 'explanations count';
  } else {
    if (!VI.test(r.promptVi ?? '')) return 'prompt not Vietnamese';
    if (!(r.requirements?.length >= 3)) return 'requirements';
    const words = String(r.sampleResponse ?? '')
      .split(/\s+/)
      .filter(Boolean).length;
    const [min, max] = d.wordRange ?? [0, 9999];
    if (words < min * 0.85 || words > max * 1.15)
      return `sample ${words} words`;
  }
  if (r.explanations?.some((e: string) => !VI.test(e)))
    return 'explanation not Vietnamese';
  if (
    r.explanations?.some((e: string) =>
      /\b[ABCD]\)|\([ABCD]\)|đáp án [ABCD]\b/i.test(e),
    )
  )
    return 'explanation names a letter';
  return null;
}

async function repair() {
  if (process.env.SKILL_PRACTICE_GEMINI_AUTHORIZED !== 'generate')
    throw new Error(
      'REFUSED: SKILL_PRACTICE_GEMINI_AUTHORIZED=generate not set',
    );
  const drafts: Drafts = JSON.parse(
    readFileSync(join(DIR, 'drafts.json'), 'utf8'),
  );
  const file = join(DIR, 'repairs.json');
  const repairs: Repairs = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : {};
  const gemini = new GeminiEvaluatorStrategy() as any;
  let requests = 0;
  for (const item of buildSpec()) {
    if (item.skill === 'SPEAKING' || repairs[item.key]) continue;
    const d = drafts[item.key];
    for (let attempt = 1; attempt <= 3 && !repairs[item.key]; attempt++) {
      requests++;
      const result = await gemini.executeWithRotation((model: any) =>
        model.generateContent({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt(item.skill, item.cefr, d) }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: SCHEMA[item.skill],
            temperature: 0.3,
          },
        }),
      );
      const r = JSON.parse(result.response.text());
      const issue = check(item.skill, d, r);
      if (issue) console.log(`${item.key} attempt ${attempt}: ${issue}`);
      else repairs[item.key] = r;
    }
    writeFileSync(file, JSON.stringify(repairs, null, 2));
  }
  console.log(
    `${Object.keys(repairs).length}/36 repaired, ${requests} requests this run`,
  );
}

async function normalize() {
  const target = arg('target');
  const url = target === 'env:DATABASE_URL' ? process.env.DATABASE_URL : target;
  if (!url) throw new Error('--target env:DATABASE_URL | <url> is required');
  const harness = /@127\.0\.0\.1:5460\//.test(url);
  if (!harness && process.env.SKILL_PRACTICE_APPLY_AUTHORIZED !== 'apply')
    throw new Error(
      'REFUSED: non-harness target needs SKILL_PRACTICE_APPLY_AUTHORIZED=apply',
    );
  const drafts: Drafts = JSON.parse(
    readFileSync(join(DIR, 'drafts.json'), 'utf8'),
  );
  const repairs: Repairs = JSON.parse(
    readFileSync(join(DIR, 'repairs.json'), 'utf8'),
  );
  const applied = JSON.parse(
    readFileSync(
      join(DIR, `applied-${harness ? 'harness' : 'target'}.json`),
      'utf8',
    ),
  );
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const json = (v: unknown) => v as Prisma.InputJsonValue;
  try {
    const items = buildSpec().filter(
      (s) => s.skill !== 'SPEAKING' && applied[s.key],
    );
    const ids = items.map((s) => Number(applied[s.key].id));
    const before = await prisma.quiz.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        publicationStatus: true,
        bilingualContent: true,
        questions: {
          select: { id: true, type: true, order: true, content: true },
        },
      },
    });
    const notDraft = before.filter((q) => q.publicationStatus !== 'DRAFT');
    if (notDraft.length)
      throw new Error(
        `REFUSED: not DRAFT anymore: ${notDraft.map((q) => q.id).join(',')}`,
      );
    const rollback = join(
      DIR,
      `normalize-rollback-${harness ? 'harness' : 'target'}-${Date.now()}.json`,
    );
    writeFileSync(rollback, JSON.stringify(before, null, 2));

    await prisma.$transaction(async (tx) => {
      for (const s of items) {
        const id = Number(applied[s.key].id);
        const d = drafts[s.key];
        const r = repairs[s.key];
        if (!r) throw new Error(`${s.key}: no repair`);
        const quiz = before.find((q) => q.id === id)!;
        const mcqs = quiz.questions
          .filter((q) => q.type === 'MULTIPLE_CHOICE' || q.type === 'WRITING')
          .sort((a, b) => a.order - b.order);
        if (s.skill === 'LISTENING') {
          const segments = (d.turns ?? []).map((t: any, i: number) => ({
            speaker: String(t.speaker),
            text: String(t.text),
            // Gemini sometimes repeats the speaker name ("Bác sĩ Vance: ...").
            // Only when the English line itself has no colon.
            translation: String(t.text).includes(':')
              ? String(r.translations[i])
              : String(r.translations[i]).replace(/^[^:.!?]{1,30}:\s*/, ''),
          }));
          const audioText = segments.map((t: any) => t.text).join(' ');
          await tx.question.deleteMany({
            where: { quizId: id, type: 'DIALOGUE' },
          });
          for (const [i, q] of mcqs.entries()) {
            const c = q.content as Record<string, any>;
            await tx.question.update({
              where: { id: q.id },
              data: {
                order: i,
                content: json({
                  text: c.text,
                  level: s.cefr,
                  skill: 'LISTENING',
                  accent: 'US',
                  options: c.options,
                  audioText,
                  correctIndex: c.correctIndex,
                  explanation: {
                    vi: r.explanations[i],
                    evidence: r.evidence[i],
                  },
                  transcriptSegments: segments,
                }),
              },
            });
          }
          await tx.quiz.update({
            where: { id },
            data: {
              bilingualContent: json({
                mode: 'DIALOGUE',
                track: 'GENERAL_ENGLISH',
                levels: [s.cefr],
                topics: r.topics.slice(0, 2),
                accents: ['US'],
                durationMinutes:
                  { A1: 10, A2: 12, B1: 15, B2: 15, C1: 18 }[s.cefr] ?? 15,
              }),
            },
          });
        } else if (s.skill === 'READING') {
          for (const [i, q] of mcqs.entries()) {
            const c = q.content as Record<string, any>;
            await tx.question.update({
              where: { id: q.id },
              data: {
                content: json({
                  text: c.text,
                  level: s.cefr,
                  skill: 'READING',
                  passage: c.passage,
                  options: c.options,
                  correctIndex: c.correctIndex,
                  explanation: r.explanations[i],
                  questionType: c.questionType,
                }),
              },
            });
          }
          await tx.quiz.update({
            where: { id },
            data: {
              bilingualContent: json({
                skill: 'READING',
                levelRange: s.cefr,
                passageTypes: r.passageTypes.slice(0, 3),
                durationMinutes: 15,
              }),
            },
          });
        } else {
          const q = mcqs[0];
          const c = q.content as Record<string, any>;
          await tx.question.update({
            where: { id: q.id },
            data: {
              content: json({
                skill: 'WRITING',
                prompt: r.promptVi,
                level: s.cefr,
                taskType: c.taskType,
                wordRange: c.wordRange,
                requirements: r.requirements,
                sampleResponse: r.sampleResponse,
                rubric: WRITING_RUBRIC,
              }),
            },
          });
        }
      }
    });
    console.log(
      `normalized ${items.length} items (${harness ? 'harness' : 'AUTHORIZED target'}); rollback ${rollback}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ quiet: true });
  const mode = process.argv[2];
  if (mode === 'repair') await repair();
  else if (mode === 'normalize') await normalize();
  else throw new Error('mode: repair | normalize');
}

if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
