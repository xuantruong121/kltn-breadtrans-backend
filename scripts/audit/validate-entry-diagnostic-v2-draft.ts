/**
 * Mechanical conformance check for the Entry Diagnostic V2 content draft.
 *
 * This is NOT a content review. It checks counts, keys, structure and
 * references only; it cannot judge whether an item is a good item.
 *
 * What this tool CAN prove mechanically:
 *   counts, draft-key uniqueness, reference resolution, answer-key structure,
 *   content hashes, forbidden process metadata, CEFR tokens, version
 *   consistency, and a fixed list of known British spellings.
 *
 * What it CANNOT prove, and must never be read as proving:
 *   that the audio is semantically required to answer a Listening item;
 *   that distractors are fair or plausible; that an inference is warranted;
 *   that a rubric measures its construct. Those are review assertions and
 *   belong to a human or to an independent reviewer, not to this file.
 *
 * Every flag below names the scope it inspected. A flag that would claim more
 * than it checked is a defect in this tool: three times in this project a
 * narrow check was reported under a broad flag name, and each time the gap
 * was found later by someone re-deriving the claim.
 *
 * Two explicit modes, because an audit tool that rewrites its own evidence is
 * not an audit tool. An earlier revision regenerated the hash manifest on every
 * run, which meant a read-only review pass still mutated the file it was
 * supposed to be checking.
 *
 *   --check          (default) recompute hashes in memory, compare against the
 *                    existing manifest, exit non-zero on any mismatch.
 *                    NEVER writes.
 *   --write-hashes   regenerate the manifest on purpose. Only for use
 *                    immediately after an intentional content revision.
 *
 * Usage:
 *   npx ts-node scripts/audit/validate-entry-diagnostic-v2-draft.ts
 *   npx ts-node scripts/audit/validate-entry-diagnostic-v2-draft.ts --check
 *   npx ts-node scripts/audit/validate-entry-diagnostic-v2-draft.ts --write-hashes
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  findActiveCefrViolations,
  findDatabaseIds,
  findProvenanceViolations,
  GUARD_SCOPE,
} from '../../src/modules/diagnostic/content-guards';
import { join } from 'node:path';

const ART = join(process.cwd(), 'artifacts');
const DRAFT = join(ART, 'entry-diagnostic-v2-content-draft.json');
const RUBRICS = join(ART, 'entry-diagnostic-v2-rubrics-draft.json');
const BLUEPRINT = join(ART, 'entry-diagnostic-v2-blueprint.json');
const MANIFEST = join(ART, 'entry-diagnostic-v2-content-draft.sha256');

const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const args = process.argv.slice(2);
const unknownFlags = args.filter(
  (arg) => arg !== '--check' && arg !== '--write-hashes',
);
if (unknownFlags.length) {
  console.error(
    `unknown argument(s): ${unknownFlags.join(', ')}\n` +
      'usage: validate-entry-diagnostic-v2-draft.ts [--check | --write-hashes]',
  );
  process.exit(2);
}
if (args.includes('--check') && args.includes('--write-hashes')) {
  console.error('--check and --write-hashes are mutually exclusive');
  process.exit(2);
}
/** Default is check: the tool must not mutate unless explicitly told to. */
const WRITE_HASHES = args.includes('--write-hashes');
const MODE = WRITE_HASHES ? 'write-hashes' : 'check';

type Failure = { check: string; detail: string };
const failures: Failure[] = [];
const notes: string[] = [];
const fail = (check: string, detail: string) =>
  failures.push({ check, detail });

const draft = JSON.parse(readFileSync(DRAFT, 'utf8'));
const rubrics = JSON.parse(readFileSync(RUBRICS, 'utf8'));
const blueprint = JSON.parse(readFileSync(BLUEPRINT, 'utf8'));

type Item = Record<string, unknown> & {
  draftKey: string;
  skill: string;
  taskType: string;
  subskill?: string;
  order: number;
  options?: string[];
  correctAnswer?: string;
  distractorRationales?: string[];
  difficultyTier?: string;
  difficultyRange?: string[];
  mediaDraftKey?: string;
  passageDraftKey?: string;
  rubricVersion?: string;
  prompt?: string;
};

const listeningItems: Item[] = draft.listening.items;
const readingItems: Item[] = draft.reading.items;
const speakingTasks: Item[] = draft.speaking.tasks;
const writingTasks: Item[] = draft.writing.tasks;
const languageUseItems: Item[] = draft.languageUse.items;
const clips = draft.listening.clips as Array<Record<string, any>>;
const passages = draft.reading.passages as Array<Record<string, any>>;

const objective = [...listeningItems, ...readingItems, ...languageUseItems];
const productive = [...speakingTasks, ...writingTasks];
const allItems = [...objective, ...productive];

// ------------------------------------------------- blueprint count conformance
const expected = blueprint.counts;
const actual = {
  listeningItems: listeningItems.length,
  listeningAudioClips: clips.length,
  readingItems: readingItems.length,
  readingPassages: passages.length,
  speakingProductiveTasks: speakingTasks.length,
  writingProductiveTasks: writingTasks.length,
  languageUseItems: languageUseItems.length,
  totalItems: allItems.length,
};
for (const [key, value] of Object.entries(actual)) {
  const want = expected[key];
  if (want !== value) {
    fail(
      'BLUEPRINT_COUNT_CONFORMANCE',
      `${key}: blueprint ${want}, draft ${value}`,
    );
  }
}

// ------------------------------------------------------------ draft key uniqueness
const allKeys = [
  ...allItems.map((i) => i.draftKey),
  ...clips.map((c) => c.draftKey as string),
  ...passages.map((p) => p.draftKey as string),
];
const seen = new Map<string, number>();
for (const key of allKeys) seen.set(key, (seen.get(key) ?? 0) + 1);
for (const [key, count] of seen) {
  if (count > 1) fail('DRAFT_KEY_UNIQUENESS', `${key} used ${count} times`);
}
if (allKeys.some((k) => !/^[A-Z]{2,4}(_[A-Z0-9]+)+$/.test(k))) {
  fail(
    'DRAFT_KEY_FORMAT',
    `non-conforming: ${allKeys.filter((k) => !/^[A-Z]{2,4}(_[A-Z0-9]+)+$/.test(k)).join(', ')}`,
  );
}
if (JSON.stringify(allKeys).match(/\bid\b"\s*:\s*\d/)) {
  fail('NO_DB_IDS', 'draft appears to contain numeric database ids');
}

// -------------------------------------------------------------- required fields
const COMMON = ['draftKey', 'skill', 'taskType', 'order'] as const;
for (const item of allItems) {
  for (const field of COMMON) {
    if (!item[field] && item[field] !== 0) {
      fail('REQUIRED_FIELD', `${item.draftKey}: missing ${field}`);
    }
  }
  if (!item.prompt || !String(item.prompt).trim()) {
    fail('REQUIRED_FIELD', `${item.draftKey}: empty prompt`);
  }
  const hasTier = Boolean(item.difficultyTier);
  const hasRange =
    Array.isArray(item.difficultyRange) && item.difficultyRange.length === 2;
  if (!hasTier && !hasRange) {
    fail(
      'DIFFICULTY_PRESENT',
      `${item.draftKey}: no difficultyTier or difficultyRange`,
    );
  }
  const tiers = hasTier ? [item.difficultyTier!] : item.difficultyRange!;
  for (const tier of tiers) {
    if (!/^D[1-4]$/.test(tier)) {
      fail('DIFFICULTY_SCALE', `${item.draftKey}: "${tier}" is not D1-D4`);
    }
  }
}

// --------------------------------------------- CEFR, provenance, database ids
// These three were previously inline regexes in this file, and all three passed
// inputs they should have rejected. They now live in
// src/modules/diagnostic/content-guards.ts with fixture tests that genuinely
// fail (content-guards.spec.ts), and traverse the parsed structure rather than
// its serialisation.
for (const violation of findActiveCefrViolations(draft)) {
  fail('NO_CEFR_IN_CONTENT', `contentDraft.${violation.path}: ${violation.kind} "${violation.token}"`);
}
for (const violation of findActiveCefrViolations(rubrics)) {
  fail('NO_CEFR_IN_CONTENT', `rubrics.${violation.path}: ${violation.kind} "${violation.token}"`);
}
// The blueprint is scanned too. It legitimately discusses CEFR in its design
// rationale, so the guard flags only tokens acting as a level - a bare code as
// a value, or a token in a level-bearing field outside the declared history
// fields. Step 2D3 fixture-proved that a result band or an item difficulty
// could previously be set to a CEFR code here with the flag still reading true.
for (const violation of findActiveCefrViolations(blueprint)) {
  fail('CEFR_BLUEPRINT_SEMANTIC', `blueprint.${violation.path}: ${violation.kind} "${violation.token}"`);
}

for (const violation of findProvenanceViolations(draft)) {
  fail('CANONICAL_PROVENANCE', `contentDraft.${violation.path}: ${violation.kind} "${violation.token}"`);
}
for (const violation of findProvenanceViolations(rubrics)) {
  fail('CANONICAL_PROVENANCE', `rubrics.${violation.path}: ${violation.kind} "${violation.token}"`);
}

for (const violation of findDatabaseIds(draft)) {
  fail('NO_DB_IDS', `contentDraft.${violation.path}: ${violation.kind} ${violation.token}`);
}
for (const violation of findDatabaseIds(rubrics)) {
  fail('NO_DB_IDS', `rubrics.${violation.path}: ${violation.kind} ${violation.token}`);
}

// ------------------------------------------------- blueprint version agreement
if (blueprint.blueprintVersion !== draft.blueprintVersion) {
  fail(
    'BLUEPRINT_VERSION_CONSISTENCY',
    `blueprint says blueprintVersion="${blueprint.blueprintVersion}" but the ` +
      `content draft says "${draft.blueprintVersion}"`,
  );
}
if (rubrics.blueprintVersion !== draft.blueprintVersion) {
  fail(
    'BLUEPRINT_VERSION_CONSISTENCY',
    `rubrics say blueprintVersion="${rubrics.blueprintVersion}" but the ` +
      `content draft says "${draft.blueprintVersion}"`,
  );
}
if (draft.scoringVersion !== blueprint.scoringVersion) {
  fail(
    'BLUEPRINT_VERSION_CONSISTENCY',
    `scoringVersion disagrees: draft "${draft.scoringVersion}" vs blueprint ` +
      `"${blueprint.scoringVersion}"`,
  );
}
if (
  rubrics.scoringVersion !== undefined &&
  rubrics.scoringVersion !== draft.scoringVersion
) {
  fail(
    'BLUEPRINT_VERSION_CONSISTENCY',
    `rubrics scoringVersion "${rubrics.scoringVersion}" disagrees with the ` +
      `draft "${draft.scoringVersion}"`,
  );
}

// -------------------------------- blueprint difficulty distribution conformance
// The blueprint's declared tier spread is now compared with the items. It was
// wrong by one in two cells and no mechanical run could see it.
{
  const declared = (blueprint.counts?.objectiveItemsByDifficultyTier ?? {}) as Record<
    string,
    unknown
  >;
  const counted = new Map<string, number>();
  for (const item of objective) {
    const tier = item.difficultyTier ?? 'UNSET';
    counted.set(tier, (counted.get(tier) ?? 0) + 1);
  }
  for (const tier of ['D1', 'D2', 'D3', 'D4']) {
    const want = declared[tier];
    const have = counted.get(tier) ?? 0;
    if (typeof want === 'number' && want !== have) {
      fail(
        'BLUEPRINT_TIER_DISTRIBUTION_CONFORMANCE',
        `blueprint declares ${tier}=${want} but the items give ${tier}=${have}`,
      );
    }
  }
}

// --------------------------------------- known British spellings, scope-declared
// A FIXED list, deliberately not presented as proof of locale consistency.
// Absence of a hit means only that these forms are absent. Judging whether the
// English reads as general American is a review assertion, not a regex result.
const BRITISH_FORMS: ReadonlyArray<readonly [string, RegExp]> = [
  ['favour', /\bfavours?\b/i],
  ['centre', /\bcentres?\b/i],
  ['lift (elevator)', /\blifts\b/i],
  ['practise', /\bpractis(?:e|ed|ing)\b/i],
  ['-ise spelling', /\b(?:organis|recognis|apologis|realis|analys)(?:e|ed|es|ing|ation|able)\b/i],
  ['queue', /\bqueue[sd]?\b/i],
  ['revision (studying)', /\brevis(?:ion|ing)\b/i],
  ['zip (fastener)', /\bzip\b/i],
  ['at weekends', /\bat weekends\b/i],
  ['student card', /\bstudent cards?\b/i],
  ['-lled spelling', /\b(?:cancelled|travelled|labelled|dialled)\b/i],
  ['colour', /\bcolou?rs?\b/i],
  ['programme', /\bprogramme\b/i],
];
// The fields a learner or a grader can actually read.
const LEARNER_FIELDS = [
  'prompt',
  'instructions',
  'script',
  'text',
  'options',
  'answerRationale',
  'distractorRationales',
] as const;
const EN_US_FIELDS_CHECKED = LEARNER_FIELDS.join(', ');
const scanForBritish = (label: string, obj: Record<string, unknown>) => {
  for (const field of LEARNER_FIELDS) {
    const value = obj[field];
    if (value === undefined) continue;
    const text = Array.isArray(value) ? value.join(' \u0000 ') : String(value);
    for (const [kind, pattern] of BRITISH_FORMS) {
      const hit = text.match(pattern);
      if (hit) {
        fail(
          'KNOWN_BRITISH_FORM',
          `${label}.${field}: "${hit[0]}" (${kind})`,
        );
      }
    }
  }
};
for (const item of allItems) scanForBritish(item.draftKey, item as never);
for (const clip of clips) scanForBritish(clip.draftKey as string, clip as never);
for (const passage of passages)
  scanForBritish(passage.draftKey as string, passage as never);
for (const task of productive)
  scanForBritish(task.draftKey as string, task as never);

// ------------------------------------------------- objective answer-key structure
for (const item of objective) {
  const options = item.options;
  if (!Array.isArray(options)) {
    fail(
      'OBJECTIVE_KEY_STRUCTURE',
      `${item.draftKey}: options is not an array`,
    );
    continue;
  }
  if (options.length < 3) {
    fail(
      'OBJECTIVE_KEY_STRUCTURE',
      `${item.draftKey}: only ${options.length} options`,
    );
  }
  if (options.some((o) => typeof o !== 'string' || !o.trim())) {
    fail(
      'OBJECTIVE_KEY_STRUCTURE',
      `${item.draftKey}: blank or non-string option`,
    );
  }
  const normalised = options.map((o) => o.trim().toLowerCase());
  if (new Set(normalised).size !== options.length) {
    fail('OBJECTIVE_KEY_STRUCTURE', `${item.draftKey}: duplicate option text`);
  }
  const matches = options.filter((o) => o === item.correctAnswer);
  if (matches.length !== 1) {
    fail(
      'OBJECTIVE_KEY_STRUCTURE',
      `${item.draftKey}: correctAnswer matches ${matches.length} options (must be exactly 1)`,
    );
  }
  if (
    !Array.isArray(item.distractorRationales) ||
    item.distractorRationales.length !== options.length
  ) {
    fail(
      'DISTRACTOR_RATIONALE_COVERAGE',
      `${item.draftKey}: ${item.distractorRationales?.length ?? 0} rationales for ${options.length} options`,
    );
  } else {
    const correctIndex = options.findIndex((o) => o === item.correctAnswer);
    if (item.distractorRationales[correctIndex] !== 'CORRECT') {
      fail(
        'DISTRACTOR_RATIONALE_COVERAGE',
        `${item.draftKey}: rationale at the correct index is not marked CORRECT`,
      );
    }
  }
}

// ------------------------------------------------------------- reference resolution
const clipKeys = new Set(clips.map((c) => c.draftKey as string));
const passageKeys = new Set(passages.map((p) => p.draftKey as string));
const rubricVersions = new Set(
  (rubrics.rubrics as Array<Record<string, any>>).map(
    (r) => r.rubricVersion as string,
  ),
);
let unresolved = 0;
for (const item of listeningItems) {
  if (!item.mediaDraftKey || !clipKeys.has(item.mediaDraftKey)) {
    fail(
      'MEDIA_REFERENCE',
      `${item.draftKey}: unresolved mediaDraftKey "${item.mediaDraftKey}"`,
    );
    unresolved += 1;
  }
}
for (const item of readingItems) {
  if (!item.passageDraftKey || !passageKeys.has(item.passageDraftKey)) {
    fail(
      'PASSAGE_REFERENCE',
      `${item.draftKey}: unresolved passageDraftKey "${item.passageDraftKey}"`,
    );
    unresolved += 1;
  }
}
for (const task of productive) {
  if (!task.rubricVersion || !rubricVersions.has(task.rubricVersion)) {
    fail(
      'RUBRIC_REFERENCE',
      `${task.draftKey}: unresolved rubricVersion "${task.rubricVersion}"`,
    );
    unresolved += 1;
  }
}
for (const rubric of rubrics.rubrics as Array<Record<string, any>>) {
  for (const taskKey of rubric.appliesToTasks as string[]) {
    if (!productive.some((t) => t.draftKey === taskKey)) {
      fail(
        'RUBRIC_REFERENCE',
        `${rubric.rubricVersion}: appliesToTasks "${taskKey}" does not exist`,
      );
      unresolved += 1;
    }
  }
}

// --------------------------------------------------------------- rubric structure
for (const rubric of rubrics.rubrics as Array<Record<string, any>>) {
  const criteria = rubric.criteria as Array<Record<string, any>>;
  if (!Array.isArray(criteria) || criteria.length !== rubric.criterionCount) {
    fail(
      'RUBRIC_STRUCTURE',
      `${rubric.rubricVersion}: criterionCount does not match criteria length`,
    );
  }
  for (const criterion of criteria ?? []) {
    if (!criterion.criterionKey || !criterion.description) {
      fail(
        'RUBRIC_STRUCTURE',
        `${rubric.rubricVersion}: criterion missing key or description`,
      );
    }
    const anchors = criterion.anchors as Array<Record<string, any>>;
    const wantAnchors = criterion.scoreMax - criterion.scoreMin + 1;
    if (!Array.isArray(anchors) || anchors.length !== wantAnchors) {
      fail(
        'RUBRIC_STRUCTURE',
        `${rubric.rubricVersion}/${criterion.criterionKey}: ${anchors?.length ?? 0} anchors for range ${criterion.scoreMin}-${criterion.scoreMax}`,
      );
    }
    for (const anchor of anchors ?? []) {
      if (!anchor.anchor || String(anchor.anchor).trim().length < 20) {
        fail(
          'RUBRIC_ANCHOR_BEHAVIOURAL',
          `${rubric.rubricVersion}/${criterion.criterionKey}: anchor at ${anchor.score} is too short to be observable`,
        );
      }
      if (
        /^(good|excellent|very good|poor|bad)\b/i.test(
          String(anchor.anchor).trim(),
        )
      ) {
        fail(
          'RUBRIC_ANCHOR_BEHAVIOURAL',
          `${rubric.rubricVersion}/${criterion.criterionKey}: anchor at ${anchor.score} is a bare value judgement`,
        );
      }
    }
  }
}

// ----------------------------------------------------- duplicate content detection
const normalise = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');
let exactDuplicates = 0;
const promptSeen = new Map<string, string[]>();
for (const item of allItems) {
  const key = normalise(String(item.prompt));
  promptSeen.set(key, [...(promptSeen.get(key) ?? []), item.draftKey]);
}
for (const [, keys] of promptSeen) {
  if (keys.length > 1) {
    fail('DUPLICATE_PROMPT', keys.join(', '));
    exactDuplicates += 1;
  }
}
const scriptSeen = new Map<string, string[]>();
for (const clip of clips) {
  const key = normalise(String(clip.script));
  scriptSeen.set(key, [
    ...(scriptSeen.get(key) ?? []),
    clip.draftKey as string,
  ]);
}
for (const [, keys] of scriptSeen) {
  if (keys.length > 1) {
    fail('DUPLICATE_SCRIPT', keys.join(', '));
    exactDuplicates += 1;
  }
}
const passageSeen = new Map<string, string[]>();
for (const passage of passages) {
  const key = normalise(String(passage.text));
  passageSeen.set(key, [
    ...(passageSeen.get(key) ?? []),
    passage.draftKey as string,
  ]);
}
for (const [, keys] of passageSeen) {
  if (keys.length > 1) {
    fail('DUPLICATE_PASSAGE', keys.join(', '));
    exactDuplicates += 1;
  }
}
// near-identical objective stems: flag, do not rewrite
for (let i = 0; i < objective.length; i += 1) {
  for (let j = i + 1; j < objective.length; j += 1) {
    const a = normalise(String(objective[i].prompt));
    const b = normalise(String(objective[j].prompt));
    if (a === b) continue;
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    if (shorter.length > 20 && longer.includes(shorter)) {
      notes.push(
        `NEAR_IDENTICAL_STEM (flagged, not rewritten): ${objective[i].draftKey} / ${objective[j].draftKey}`,
      );
    }
  }
}

// ------------------------------------------------------------- order contiguity
const orders = allItems.map((i) => i.order).sort((x, y) => x - y);
const expectedOrders = Array.from({ length: allItems.length }, (_, i) => i + 1);
if (JSON.stringify(orders) !== JSON.stringify(expectedOrders)) {
  fail(
    'ORDER_CONTIGUITY',
    `orders are not 1..${allItems.length}: ${orders.join(',')}`,
  );
}

// ------------------------------------------------------------------ distributions
const byTier: Record<string, number> = {};
for (const item of objective) {
  const tier = item.difficultyTier ?? 'UNSET';
  byTier[tier] = (byTier[tier] ?? 0) + 1;
}
const bySubskill: Record<string, number> = {};
for (const item of allItems) {
  const key = `${item.skill}/${item.subskill ?? '-'}`;
  bySubskill[key] = (bySubskill[key] ?? 0) + 1;
}
const itemsByClip: Record<string, number> = {};
for (const item of listeningItems) {
  itemsByClip[item.mediaDraftKey!] =
    (itemsByClip[item.mediaDraftKey!] ?? 0) + 1;
}
const itemsByPassage: Record<string, number> = {};
for (const item of readingItems) {
  itemsByPassage[item.passageDraftKey!] =
    (itemsByPassage[item.passageDraftKey!] ?? 0) + 1;
}
const correctIndexDistribution: Record<string, number> = {};
for (const item of objective) {
  const index = (item.options ?? []).findIndex((o) => o === item.correctAnswer);
  const label = ['A', 'B', 'C', 'D'][index] ?? `idx${index}`;
  correctIndexDistribution[label] = (correctIndexDistribution[label] ?? 0) + 1;
}
const correctSequence = objective
  .slice()
  .sort((a, b) => a.order - b.order)
  .map(
    (item) =>
      ['A', 'B', 'C', 'D'][
        (item.options ?? []).findIndex((o) => o === item.correctAnswer)
      ] ?? '?',
  )
  .join('');

const wordCount = (text: string) =>
  text.trim().split(/\s+/).filter(Boolean).length;
const passageWordCounts: Record<string, number> = {};
for (const passage of passages) {
  const counted = wordCount(String(passage.text));
  passageWordCounts[passage.draftKey as string] = counted;
  if (Math.abs(counted - Number(passage.wordCount)) > 5) {
    fail(
      'PASSAGE_WORDCOUNT',
      `${passage.draftKey}: declared ${passage.wordCount}, counted ${counted}`,
    );
  }
}
const scriptWordCounts: Record<string, number> = {};
const scriptDurations: Record<string, number> = {};
for (const clip of clips) {
  scriptWordCounts[clip.draftKey as string] = wordCount(String(clip.script));
  scriptDurations[clip.draftKey as string] = Number(
    clip.estimatedDurationSeconds,
  );
}

// ------------------------------------------------------------------ hash manifest
const hashes: Array<{ target: string; sha256: string }> = [];
for (const clip of clips) {
  hashes.push({
    target: `script:${clip.draftKey}`,
    sha256: sha256(String(clip.script)),
  });
}
for (const passage of passages) {
  hashes.push({
    target: `passage:${passage.draftKey}`,
    sha256: sha256(String(passage.text)),
  });
}
for (const task of productive) {
  hashes.push({
    target: `prompt:${task.draftKey}`,
    sha256: sha256(String(task.prompt)),
  });
}
hashes.push({
  target: 'rubrics:json',
  sha256: sha256(JSON.stringify(rubrics)),
});
hashes.push({
  target: 'contentDraft:json',
  sha256: sha256(readFileSync(DRAFT, 'utf8')),
});

const renderManifest = (generatedAt: string) =>
  [
    '# Entry Diagnostic V2 content draft - SHA-256 manifest',
    '# Binds reviewed content to what a later persistence or TTS step consumes.',
    `# generated ${generatedAt}`,
    '',
    ...hashes.map((h) => `${h.sha256}  ${h.target}`),
    '',
  ].join('\n');

let hashCheckPass = true;
let hashMismatchCount = 0;
let manifestWritten = false;

if (WRITE_HASHES) {
  writeFileSync(MANIFEST, renderManifest(new Date().toISOString()));
  manifestWritten = true;
} else {
  // Check mode: compare in memory only. The manifest file is never opened for
  // writing, so a review pass cannot disturb the evidence it is checking.
  if (!existsSync(MANIFEST)) {
    fail('HASH_MANIFEST_PRESENT', `no manifest at ${MANIFEST}; run --write-hashes once`);
    hashCheckPass = false;
  } else {
    const recorded = new Map<string, string>();
    for (const line of readFileSync(MANIFEST, 'utf8').split('\n')) {
      const match = line.match(/^([0-9a-f]{64})\s+(.+)$/);
      if (match) recorded.set(match[2].trim(), match[1]);
    }
    for (const entry of hashes) {
      const was = recorded.get(entry.target);
      if (!was) {
        fail('HASH_MANIFEST_COVERAGE', `${entry.target} is absent from the manifest`);
        hashMismatchCount += 1;
      } else if (was !== entry.sha256) {
        fail(
          'HASH_MISMATCH',
          `${entry.target}\n      manifest   ${was}\n      recomputed ${entry.sha256}`,
        );
        hashMismatchCount += 1;
      }
    }
    for (const target of recorded.keys()) {
      if (!hashes.some((entry) => entry.target === target)) {
        fail('HASH_MANIFEST_COVERAGE', `${target} is in the manifest but no longer produced`);
        hashMismatchCount += 1;
      }
    }
    hashCheckPass = hashMismatchCount === 0;
  }
}

// ------------------------------------------------------------------------ report
console.log(`=== Entry Diagnostic V2 draft validation (mechanical only) [mode: ${MODE}] ===\n`);
console.log('counts vs blueprint:');
for (const [key, value] of Object.entries(actual)) {
  console.log(
    `  ${key.padEnd(26)} ${String(value).padStart(3)}  (blueprint ${expected[key]})`,
  );
}
console.log(
  `\nITEMS_BY_DIFFICULTY_TIER (objective)  ${JSON.stringify(byTier)}`,
);
console.log('ITEMS_BY_SUBSKILL:');
for (const [key, value] of Object.entries(bySubskill).sort()) {
  console.log(`  ${key.padEnd(44)} ${value}`);
}
console.log(`\nLISTENING_ITEMS_BY_CLIP        ${JSON.stringify(itemsByClip)}`);
console.log(`READING_ITEMS_BY_PASSAGE      ${JSON.stringify(itemsByPassage)}`);
console.log(
  `CORRECT_OPTION_DISTRIBUTION   ${JSON.stringify(correctIndexDistribution)}`,
);
console.log(`CORRECT_OPTION_SEQUENCE       ${correctSequence}`);
console.log(
  `\nREADING_PASSAGE_WORD_COUNTS   ${JSON.stringify(passageWordCounts)}`,
);
console.log(
  `READING_TOTAL_WORD_COUNT      ${Object.values(passageWordCounts).reduce((a, b) => a + b, 0)}`,
);
console.log(
  `LISTENING_SCRIPT_WORD_COUNTS  ${JSON.stringify(scriptWordCounts)}`,
);
console.log(`LISTENING_ESTIMATED_DURATIONS ${JSON.stringify(scriptDurations)}`);
if (manifestWritten) {
  console.log(`\nhash manifest REGENERATED: ${hashes.length} entries -> ${MANIFEST}`);
} else {
  console.log(
    `\nhash check: ${hashes.length} recomputed, ${hashMismatchCount} mismatch(es); manifest not written`,
  );
}

if (notes.length) {
  console.log('\nflagged for the reviewer (not auto-corrected):');
  for (const note of notes) console.log(`  ${note}`);
}

console.log(`\nDUPLICATE_EXACT_CONTENT_COUNT=${exactDuplicates}`);
console.log(`UNRESOLVED_DRAFT_REFERENCES=${unresolved}`);
console.log(
  `DRAFT_KEY_UNIQUENESS_PASS=${!failures.some((f) => f.check.startsWith('DRAFT_KEY'))}`,
);
console.log(
  `BLUEPRINT_COUNT_CONFORMANCE_PASS=${!failures.some((f) => f.check === 'BLUEPRINT_COUNT_CONFORMANCE')}`,
);
console.log(
  `OBJECTIVE_KEY_STRUCTURE_PASS=${!failures.some((f) => f.check === 'OBJECTIVE_KEY_STRUCTURE')}`,
);
console.log(
  `RUBRIC_STRUCTURAL_VALIDATION_PASS=${!failures.some((f) => f.check.startsWith('RUBRIC'))}`,
);
const cefrPass = !failures.some((f) => f.check === 'NO_CEFR_IN_CONTENT');
console.log(
  `CEFR_BLUEPRINT_SEMANTIC_GUARD_PASS=${!failures.some((f) => f.check === 'CEFR_BLUEPRINT_SEMANTIC')}`,
);
console.log(
  `CEFR_ACTIVE_SEMANTIC_LEAK_COUNT=${failures.filter((f) => f.check === 'NO_CEFR_IN_CONTENT' || f.check === 'CEFR_BLUEPRINT_SEMANTIC').length}`,
);
console.log(`  ACTIVE_CEFR_GUARD_SCOPE=${GUARD_SCOPE.activeCefr}`);
console.log(
  `NO_DB_IDS_GUARD_PASS=${!failures.some((f) => f.check === 'NO_DB_IDS')}`,
);
console.log(`  NO_DB_IDS_GUARD_SCOPE=${GUARD_SCOPE.databaseIds}`);
console.log(
  `BLUEPRINT_TIER_DISTRIBUTION_CONFORMANCE_PASS=${!failures.some((f) => f.check === 'BLUEPRINT_TIER_DISTRIBUTION_CONFORMANCE')}`,
);
console.log(
  '  GUARDS_TESTED_IN=src/modules/diagnostic/content-guards.spec.ts (negative fixtures)',
);
console.log(`NO_CEFR_IN_CONTENT_PASS=${cefrPass}`);
console.log(`CEFR_CANONICAL_CONTENT_GUARD_PASS=${cefrPass}`);
console.log(
  `CANONICAL_PROVENANCE_GUARD_PASS=${!failures.some((f) => f.check === 'CANONICAL_PROVENANCE')}`,
);
console.log(`  PROVENANCE_GUARD_SCOPE=${GUARD_SCOPE.provenance}`);
console.log(
  `BLUEPRINT_VERSION_CONSISTENCY_GUARD_PASS=${!failures.some((f) => f.check === 'BLUEPRINT_VERSION_CONSISTENCY')}`,
);
console.log(
  `  BLUEPRINT_VERSION=${draft.blueprintVersion} (draft, blueprint and rubrics compared)`,
);
console.log(
  `KNOWN_BRITISH_FORM_COUNT=${failures.filter((f) => f.check === 'KNOWN_BRITISH_FORM').length}`,
);
console.log(`  EN_US_FIELDS_CHECKED=${EN_US_FIELDS_CHECKED}`);
console.log(
  '  EN_US_GUARD_CAVEAT=fixed word list; absence proves only these forms are absent, NOT locale consistency',
);
console.log(`VALIDATOR_MODE=${MODE}`);
console.log(`MANIFEST_WRITTEN=${manifestWritten}`);
console.log(`HASH_MISMATCH_COUNT=${hashMismatchCount}`);
console.log(`POST_REVISION_HASH_CHECK_PASS=${WRITE_HASHES ? 'n/a (write mode)' : hashCheckPass}`);

if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  for (const failure of failures) {
    console.log(`  [${failure.check}] ${failure.detail}`);
  }
  console.log('\nMECHANICAL_VALIDATION_PASS=false');
  process.exitCode = 1;
} else {
  console.log('\nMECHANICAL_VALIDATION_PASS=true');
  console.log(
    'NOTE: mechanical only. Content quality, item validity, distractor quality, level\n' +
      '      appropriateness and rubric validity remain NOT_REVIEWED_IN_AUTHORING_PHASE.',
  );
}
