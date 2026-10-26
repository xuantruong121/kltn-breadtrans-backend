/**
 * Canonical Entry Diagnostic content importer.
 *
 * Takes the approved, hash-frozen content artifacts and writes them as an
 * INACTIVE DRAFT assessment, idempotently, inside one transaction.
 *
 * Design constraints this file exists to honour:
 *
 *  - **Never relies on a database default.** `isActive` defaults to `true` and
 *    `status` to `ACTIVE`, so omitting either would make a half-built form the
 *    learner-current one. Both are written explicitly on every path.
 *  - **Never spreads.** Every column is named; the mapper's allowlist throws on
 *    an authoring field or an unknown column.
 *  - **Never deletes.** Matching is upsert-by-identity only. A
 *    delete-then-reinsert would orphan attempt references.
 *  - **Cannot touch legacy rows.** Every write is scoped by `sourceKey`, and
 *    every V1 row has `sourceKey = NULL`, which a unique index treats as
 *    distinct and an equality match never finds.
 *  - **Verifies the content before trusting it.** The hash manifest is checked
 *    first, so rows can only come from the reviewed package.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  mapObjectiveQuestion,
  mapProductiveTask,
  type ObjectiveDraftItem,
  type ProductiveDraftItem,
} from './v2-import-mapper';

/** The subset of the Prisma client the importer needs; keeps this unit testable. */
export type ImporterClient = {
  $transaction: <T>(fn: (tx: ImporterTx) => Promise<T>) => Promise<T>;
};
export type ImporterTx = Record<string, any>;

export type ImportOptions = {
  artifactDir?: string;
  /** Test hook: throw at a chosen point to prove the transaction rolls back. */
  failAfter?: 'assessment' | 'passages' | 'rubrics' | 'questions' | 'clips';
  /** Skip the manifest check only when a fixture deliberately alters content. */
  verifyHashes?: boolean;
};

export type ImportResult = {
  assessmentId: number;
  created: Record<string, number>;
  updated: Record<string, number>;
  unchanged: Record<string, number>;
  isActive: boolean;
  status: string;
};

const ASSESSMENT_SOURCE_KEY = 'DIAG_V2_ASSESSMENT';
const sha256 = (v: string) =>
  createHash('sha256').update(v, 'utf8').digest('hex');

type Draft = {
  blueprintVersion: string;
  scoringVersion: string;
  contentVersion: number;
  assessment?: Record<string, unknown>;
  listening: { clips: any[]; items: ObjectiveDraftItem[] };
  reading: { passages: any[]; items: ObjectiveDraftItem[] };
  speaking: { tasks: ProductiveDraftItem[] };
  writing: { tasks: ProductiveDraftItem[] };
  languageUse: { items: ObjectiveDraftItem[] };
};

export function loadApprovedContent(artifactDir: string, verifyHashes = true) {
  const draft = JSON.parse(
    readFileSync(
      join(artifactDir, 'entry-diagnostic-v2-content-draft.json'),
      'utf8',
    ),
  ) as Draft;
  const rubricsDoc = JSON.parse(
    readFileSync(
      join(artifactDir, 'entry-diagnostic-v2-rubrics-draft.json'),
      'utf8',
    ),
  ) as { rubrics: any[] };

  if (verifyHashes) {
    const manifest = readFileSync(
      join(artifactDir, 'entry-diagnostic-v2-content-draft.sha256'),
      'utf8',
    );
    const recorded = new Map<string, string>();
    for (const line of manifest.split('\n')) {
      const m = line.match(/^([0-9a-f]{64})\s+(.+)$/);
      if (m) recorded.set(m[2].trim(), m[1]);
    }
    const checks: Array<[string, string]> = [
      ...draft.listening.clips.map(
        (c) => [`script:${c.draftKey}`, c.script] as [string, string],
      ),
      ...draft.reading.passages.map(
        (p) => [`passage:${p.draftKey}`, p.text] as [string, string],
      ),
    ];
    for (const [target, text] of checks) {
      const want = recorded.get(target);
      if (!want)
        throw new Error(
          `import refused: ${target} is absent from the manifest`,
        );
      if (want !== sha256(text)) {
        throw new Error(
          `import refused: ${target} does not match the approved manifest hash`,
        );
      }
    }
  }
  return { draft, rubricsDoc };
}

/**
 * Order-independent serialisation. `options` is a `jsonb` column, and Postgres
 * does not preserve object key order, so a plain `JSON.stringify` comparison
 * reports a difference on a byte-identical re-import.
 */
function canonical(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

/**
 * Write one field set only when it actually differs, so a re-import reports
 * "unchanged" rather than rewriting identical rows and bumping `updatedAt`.
 */
function differs(
  existing: Record<string, any>,
  next: Record<string, any>,
): boolean {
  return Object.keys(next).some(
    (k) => canonical(existing?.[k]) !== canonical(next[k]),
  );
}

/**
 * Fails closed on any repeated authored identity, naming the duplicate. Covers
 * questions, passages, clips and rubrics: every identity the importer matches
 * rows by. A duplicate is a content-authoring error, not a merge instruction.
 */
export function assertUniqueSourceKeys(
  draft: Draft,
  rubricsDoc: { rubrics: any[] },
): void {
  const groups: Array<[string, string[]]> = [
    [
      'question draftKey',
      [
        ...draft.listening.items,
        ...draft.reading.items,
        ...draft.languageUse.items,
        ...draft.speaking.tasks,
        ...draft.writing.tasks,
      ].map((i: any) => i.draftKey),
    ],
    ['passage draftKey', draft.reading.passages.map((p: any) => p.draftKey)],
    ['clip draftKey', draft.listening.clips.map((c: any) => c.draftKey)],
    [
      'rubric identity',
      rubricsDoc.rubrics.map((r: any) => `${r.skill}@${r.rubricVersion}`),
    ],
  ];
  for (const [label, keys] of groups) {
    const seen = new Set<string>();
    for (const key of keys) {
      if (key === undefined || key === null || key === '') {
        throw new Error(`import refused: an item has no ${label}`);
      }
      if (seen.has(key)) {
        throw new Error(`import refused: duplicate ${label} "${key}"`);
      }
      seen.add(key);
    }
  }
}

export async function importApprovedContent(
  prisma: ImporterClient,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const artifactDir =
    options.artifactDir ?? join(__dirname, '..', '..', '..', 'artifacts');
  const { draft, rubricsDoc } = loadApprovedContent(
    artifactDir,
    options.verifyHashes !== false,
  );

  // Source identity must be unique BEFORE anything is written. Two authored
  // items sharing a draftKey would both upsert onto the same row, so the second
  // silently overwrites the first's content - and the row-count assertions
  // below cannot see it, because the count never changes. Found in B1 Test E.
  assertUniqueSourceKeys(draft, rubricsDoc);

  const created: Record<string, number> = {};
  const updated: Record<string, number> = {};
  const unchanged: Record<string, number> = {};
  const bump = (bag: Record<string, number>, k: string) => {
    bag[k] = (bag[k] ?? 0) + 1;
  };

  return prisma.$transaction(async (tx: ImporterTx) => {
    // ---------------------------------------------------------- assessment
    // isActive and status are ALWAYS written, never defaulted. contentVersion
    // is the approved draft's: omitting it left the column at its schema
    // default of 1 while the imported content was version 6 (C2-FIND-001).
    if (!Number.isInteger(draft.contentVersion) || draft.contentVersion < 1)
      throw new Error(
        `CONTENT_VERSION_INVALID: approved draft has contentVersion ${String(draft.contentVersion)}`,
      );
    const assessmentFields = {
      title: String(draft.assessment?.title ?? 'Kiểm tra đầu vào'),
      description: String(draft.assessment?.description ?? ''),
      isActive: false,
      status: 'DRAFT',
      scoringVersion: draft.scoringVersion,
      blueprintVersion: draft.blueprintVersion,
      contentVersion: draft.contentVersion,
    };
    const existingAssessment = await tx.diagnosticAssessment.findUnique({
      where: { sourceKey: ASSESSMENT_SOURCE_KEY },
    });
    let assessment: { id: number; isActive: boolean; status: string };
    if (!existingAssessment) {
      assessment = await tx.diagnosticAssessment.create({
        data: { sourceKey: ASSESSMENT_SOURCE_KEY, ...assessmentFields },
      });
      bump(created, 'assessment');
    } else if (differs(existingAssessment, assessmentFields)) {
      assessment = await tx.diagnosticAssessment.update({
        where: { id: existingAssessment.id },
        data: assessmentFields,
      });
      bump(updated, 'assessment');
    } else {
      assessment = existingAssessment;
      bump(unchanged, 'assessment');
    }
    if (options.failAfter === 'assessment')
      throw new Error('injected failure: assessment');

    // ------------------------------------------------------------ passages
    const passageIds: Record<string, number> = {};
    const passageTexts: Record<string, string> = {};
    for (const p of draft.reading.passages) {
      // `title` is deliberately NULL: the authored internalLabel is
      // answer-bearing (D5-001) and must never reach a learner-visible column.
      const fields = {
        title: null as string | null,
        text: String(p.text),
        order: Number(p.order ?? 0),
      };
      passageTexts[p.draftKey] = String(p.text);
      const existing = await tx.diagnosticReadingPassage.findFirst({
        where: { assessmentId: assessment.id, sourceKey: p.draftKey },
      });
      if (!existing) {
        const row = await tx.diagnosticReadingPassage.create({
          data: {
            assessmentId: assessment.id,
            sourceKey: p.draftKey,
            ...fields,
          },
        });
        passageIds[p.draftKey] = row.id;
        bump(created, 'passage');
      } else {
        passageIds[p.draftKey] = existing.id;
        if (differs(existing, fields)) {
          await tx.diagnosticReadingPassage.update({
            where: { id: existing.id },
            data: fields,
          });
          bump(updated, 'passage');
        } else bump(unchanged, 'passage');
      }
    }
    if (options.failAfter === 'passages')
      throw new Error('injected failure: passages');

    // ------------------------------------------------------------- rubrics
    // Already has stable identity: @@unique([skill, rubricVersion]).
    const rubricIds: Record<string, number> = {};
    for (const r of rubricsDoc.rubrics) {
      const fields = {
        criteria: r.criteria,
        maxScore: Number(r.maxPerCriterion ?? 4),
      };
      const existing = await tx.diagnosticRubric.findFirst({
        where: { skill: r.skill, rubricVersion: r.rubricVersion },
      });
      if (!existing) {
        const row = await tx.diagnosticRubric.create({
          data: { skill: r.skill, rubricVersion: r.rubricVersion, ...fields },
        });
        rubricIds[r.rubricVersion] = row.id;
        bump(created, 'rubric');
      } else {
        rubricIds[r.rubricVersion] = existing.id;
        if (differs(existing, fields)) {
          await tx.diagnosticRubric.update({
            where: { id: existing.id },
            data: fields,
          });
          bump(updated, 'rubric');
        } else bump(unchanged, 'rubric');
      }
    }
    if (options.failAfter === 'rubrics')
      throw new Error('injected failure: rubrics');

    // ----------------------------------------------------------- questions
    const ctx = {
      assessmentId: assessment.id,
      passageIds,
      rubricIds,
      passageTexts,
    };
    const objective = [
      ...draft.listening.items,
      ...draft.reading.items,
      ...draft.languageUse.items,
    ];
    const productive = [...draft.speaking.tasks, ...draft.writing.tasks];
    const questionIds: Record<string, number> = {};

    const persist = async (payload: Record<string, any>, sourceKey: string) => {
      // Both identity fields are written explicitly below, so they are dropped
      // from the mapped payload rather than supplied twice.
      const fields = Object.fromEntries(
        Object.entries(payload).filter(
          ([key]) => key !== 'sourceKey' && key !== 'assessmentId',
        ),
      );
      const existing = await tx.diagnosticQuestion.findFirst({
        where: { assessmentId: assessment.id, sourceKey },
      });
      if (!existing) {
        const row = await tx.diagnosticQuestion.create({
          data: { assessmentId: assessment.id, sourceKey, ...fields },
        });
        questionIds[sourceKey] = row.id;
        bump(created, 'question');
      } else {
        questionIds[sourceKey] = existing.id;
        if (differs(existing, fields)) {
          await tx.diagnosticQuestion.update({
            where: { id: existing.id },
            data: fields,
          });
          bump(updated, 'question');
        } else bump(unchanged, 'question');
      }
    };

    for (const item of objective) {
      await persist(mapObjectiveQuestion(item, ctx) as any, item.draftKey);
    }
    for (const task of productive) {
      await persist(mapProductiveTask(task, ctx) as any, task.draftKey);
    }
    if (options.failAfter === 'questions')
      throw new Error('injected failure: questions');

    // --------------------------------------------------------------- clips
    // One registry row per LISTENING QUESTION, as B1 decided: the table is
    // keyed @@unique([questionId, version]) and the readiness guard is phrased
    // per item. Questions on the same authored clip share one audio asset -
    // same storageKey, url, script and hashes. No audio is generated here.
    const clipByKey = new Map(
      draft.listening.clips.map((c) => [c.draftKey, c]),
    );
    for (const item of draft.listening.items) {
      const clip = clipByKey.get(item.mediaDraftKey!);
      if (!clip)
        throw new Error(
          `${item.draftKey}: clip ${item.mediaDraftKey} unresolved`,
        );
      const questionId = questionIds[item.draftKey];
      const fields = {
        isActive: false,
        storageKey: `diagnostic/v2/${clip.draftKey}.pending`,
        url: '',
        mimeType: 'audio/mpeg',
        script: String(clip.script),
        scriptSha256: sha256(String(clip.script)),
        locale: String(clip.localeIntent ?? ''),
        accent: String(clip.accentIntent ?? ''),
        generationSource: 'PENDING_PHASE_E',
      };
      const existing = await tx.diagnosticListeningClip.findFirst({
        where: { questionId, version: 1 },
      });
      if (!existing) {
        await tx.diagnosticListeningClip.create({
          data: { questionId, version: 1, ...fields },
        });
        bump(created, 'clip');
      } else if (differs(existing, fields)) {
        await tx.diagnosticListeningClip.update({
          where: { id: existing.id },
          data: fields,
        });
        bump(updated, 'clip');
      } else bump(unchanged, 'clip');
    }
    if (options.failAfter === 'clips')
      throw new Error('injected failure: clips');

    // ------------------------------------------------ in-transaction asserts
    const qCount = await tx.diagnosticQuestion.count({
      where: { assessmentId: assessment.id },
    });
    if (qCount !== 29)
      throw new Error(`expected 29 questions, found ${qCount}`);
    const pCount = await tx.diagnosticReadingPassage.count({
      where: { assessmentId: assessment.id },
    });
    if (pCount !== 3) throw new Error(`expected 3 passages, found ${pCount}`);
    const fresh = await tx.diagnosticAssessment.findUnique({
      where: { id: assessment.id },
    });
    if (fresh.isActive !== false || fresh.status !== 'DRAFT') {
      throw new Error('refusing: imported assessment is not an inactive DRAFT');
    }

    return {
      assessmentId: assessment.id,
      created,
      updated,
      unchanged,
      isActive: fresh.isActive,
      status: fresh.status,
    };
  });
}
