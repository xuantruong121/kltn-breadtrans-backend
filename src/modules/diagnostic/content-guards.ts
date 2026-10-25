/**
 * Mechanical guards over the Entry Diagnostic V2 authored content package.
 *
 * These are pure functions so they can be unit-tested with fixtures that
 * genuinely fail. Three earlier revisions of these checks lived inline in the
 * audit script as raw-text regexes and each one passed inputs it should have
 * rejected:
 *
 *   - the provenance scan relied on `\b`, which does not fire between `_` and a
 *     letter, so the SCREAMING_SNAKE status values this project actually
 *     produces slipped through;
 *   - the CEFR scan never looked at the blueprint, the one file where a CEFR
 *     token could land in a result-band or item-difficulty field;
 *   - the database-id check was applied to an array of key strings, so it could
 *     not fail at all.
 *
 * All three now traverse the parsed JSON structure rather than its
 * serialisation, and each inspects keys as well as values.
 *
 * What these guards CANNOT do: judge whether audio is semantically required,
 * whether a distractor is fair, or whether a rubric measures its construct.
 * Those are review assertions.
 */

export type GuardViolation = {
  /** JSON path of the offending node, e.g. `listening.items[3].prompt`. */
  path: string;
  /** What was matched. */
  token: string;
  /** Why it is forbidden. */
  kind: string;
};

type Visitor = (path: string, key: string, value: string) => void;

/**
 * Walk a parsed JSON value, calling `visit` for every string encountered —
 * both object keys and string values. Keys are visited too because a forbidden
 * token can hide in a field name (`notes_REV_014`) as easily as in prose.
 */
export function walkStrings(value: unknown, visit: Visitor, path = ''): void {
  if (typeof value === 'string') {
    visit(path, path.split(/[.[]/).pop() ?? '', value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, visit, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      // The key itself is content as far as these guards are concerned.
      visit(childPath, key, key);
      walkStrings(entry, visit, childPath);
    }
  }
}

/**
 * Review-process metadata that must never ride into canonical content.
 *
 * Deliberately NOT using `\b` on the left of an identifier: `\b` does not match
 * between `_` and `R`, so `STATUS=CLOSED_BY_REV-014` defeated the previous
 * pattern. `(?:^|[^A-Za-z])` matches a start-of-string or any non-letter,
 * including `_`.
 */
const PROVENANCE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['revision identifier', /(?:^|[^A-Za-z])REV(?:ISION)?[-_ ]?\d+/i],
  ['issue identifier', /(?:^|[^A-Za-z])(?:IR|DEF|D\d)[-_ ]?\d+/i],
  ['requires-pass token', /REQUIRES[-_ ]?STEP/i],
  ['pass name', /(?:^|[^A-Za-z])STEP[-_ ]?\d[-_ ]?[A-E]?\d?(?:[^A-Za-z]|$)/i],
  ['pass name', /(?:^|[^A-Za-z])(?:Pass|Phase|Step)[-_ ]*\d/i],
  [
    'review artifact filename',
    /content-review|revision-register|authoring-report|step2[a-e]|entry-diagnostic-v2-step/i,
  ],
];

/** Scan a whole content document for review-process provenance. */
export function findProvenanceViolations(document: unknown): GuardViolation[] {
  const found: GuardViolation[] = [];
  walkStrings(document, (path, _key, value) => {
    for (const [kind, pattern] of PROVENANCE_PATTERNS) {
      const hit = value.match(pattern);
      if (hit) {
        found.push({ path, token: hit[0].trim(), kind });
        return;
      }
    }
  });
  return found;
}

const CEFR_TOKEN = /(?:^|[^A-Za-z])(?:Pre-A1|A1|A2|B1|B2|C1|C2|CEFR)(?:[^A-Za-z]|$)/i;
/** A value that is nothing but a CEFR code is acting as a level, not prose. */
const CEFR_EXACT = /^\s*(?:Pre-A1|A1|A2|B1|B2|C1|C2)\s*$/i;
/** Field names that make a CEFR token semantically ACTIVE. */
const CEFR_ACTIVE_KEY =
  /band|level|tier|difficulty|cefrEquivalent|placement|cutoff|threshold/i;
/**
 * Fields where a CEFR mention is legitimate design history or an explicit
 * disclaimer. Matched against the leaf key, not the full path.
 */
const CEFR_HISTORICAL_KEYS = new Set([
  'previousDraftDifficultyNote',
  'cefrClaimBasis',
  'notCefr',
  'notAnExamination',
  'learnerFacingWording',
  'basis',
  'researchBasis',
  'futureCefrAlignmentProcedures',
  'whyRemovedRatherThanCorrected',
  'problem',
  'note',
  'status',
]);

/**
 * Find CEFR tokens that are acting as a learner level, an item difficulty, a
 * rubric level or a placement output — as opposed to prose explaining why no
 * CEFR claim is made, which is legitimate and must not be banned.
 */
export function findActiveCefrViolations(document: unknown): GuardViolation[] {
  const found: GuardViolation[] = [];
  walkStrings(document, (path, key, value) => {
    const exact = CEFR_EXACT.test(value);
    const historical = CEFR_HISTORICAL_KEYS.has(key);
    // A bare CEFR code is active wherever it sits, unless the field is one of
    // the declared history fields.
    if (exact && !historical) {
      found.push({
        path,
        token: value.trim(),
        kind: 'CEFR code used as a value (active level)',
      });
      return;
    }
    // Otherwise it is active only when the field name says it carries a level.
    if (!historical && CEFR_ACTIVE_KEY.test(key) && CEFR_TOKEN.test(value)) {
      const hit = value.match(CEFR_TOKEN);
      found.push({
        path,
        token: (hit?.[0] ?? value).trim(),
        kind: 'CEFR token in a level-bearing field',
      });
    }
  });
  return found;
}

/**
 * Database-generated identifiers must not appear in an authored draft: the
 * draft addresses objects by `draftKey`, and a numeric `id` would mean someone
 * round-tripped a persisted row back into the authoring artifact.
 *
 * Matches a key named `id` or ending in `Id` whose value is a number. String
 * identifiers such as `scaleId` are left alone, as are every legitimate numeric
 * field (`order`, `wordMin`, `estimatedSeconds`, scores, versions), none of
 * which is named like an id.
 */
export function findDatabaseIds(document: unknown): GuardViolation[] {
  const found: GuardViolation[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (/^(?:id|[A-Za-z0-9]*Id)$/.test(key) && typeof entry === 'number') {
        found.push({
          path: childPath,
          token: String(entry),
          kind: 'database-generated numeric identifier',
        });
      }
      visit(entry, childPath);
    }
  };
  visit(document, '');
  return found;
}

export const GUARD_SCOPE = {
  provenance:
    'every key and every string value of the content draft and the rubrics document',
  activeCefr:
    'every key and every string value of the content draft, the rubrics document and the blueprint; bare CEFR codes are active anywhere outside the declared history fields',
  databaseIds:
    'every object key of the content draft and the rubrics document, matching `id` or `*Id` with a numeric value',
} as const;
