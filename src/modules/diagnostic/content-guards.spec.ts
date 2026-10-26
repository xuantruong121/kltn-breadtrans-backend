import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  findActiveCefrViolations,
  findDatabaseIds,
  findProvenanceViolations,
} from './content-guards';

const ART = join(__dirname, '..', '..', '..', 'artifacts');
const readArtifact = (name: string): unknown =>
  JSON.parse(readFileSync(join(ART, name), 'utf8'));

const draft = () => readArtifact('entry-diagnostic-v2-content-draft.json');
const rubrics = () => readArtifact('entry-diagnostic-v2-rubrics-draft.json');
const blueprint = () => readArtifact('entry-diagnostic-v2-blueprint.json');

/** Deep clone so a fixture can never mutate the canonical artifact. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('provenance guard', () => {
  it('passes the real content draft and rubrics', () => {
    expect(findProvenanceViolations(draft())).toEqual([]);
    expect(findProvenanceViolations(rubrics())).toEqual([]);
  });

  // The variants that defeated the previous `\b`-anchored pattern. Each of
  // these was silently accepted before; every one must now fail.
  const awkward = [
    'REV_014',
    'REV-7',
    'REVISION-012',
    'IR017',
    'IR_017',
    'D3-001',
    'DEF-004',
    'REQUIRES STEP',
    'REQUIRES-STEP',
    'REQUIRES_STEP2D4_REVIEW',
    'STATUS=CLOSED_BY_REV-014',
    'Pass 2C',
    'Phase 2C',
    'Step 4',
    'see entry-diagnostic-v2-step2c3-revisions.json',
    'content-review',
    'revision-register',
  ];

  it.each(awkward)(
    'detects the awkward variant %p in a string value',
    (token) => {
      const fixture = clone(draft()) as Record<string, unknown>;
      (
        fixture.listening as { items: Record<string, unknown>[] }
      ).items[0].prompt = `What are the speakers mainly discussing? ${token}`;
      const hits = findProvenanceViolations(fixture);
      expect(hits.length).toBeGreaterThan(0);
    },
  );

  it.each(awkward)(
    'detects the awkward variant %p in an object KEY',
    (token) => {
      const fixture = clone(draft()) as Record<string, unknown>;
      fixture[`note_${token}`] = 'anything';
      expect(findProvenanceViolations(fixture).length).toBeGreaterThan(0);
    },
  );

  it('detects a token nested deep inside arrays and objects', () => {
    const fixture = clone(draft()) as Record<string, unknown>;
    const items = (fixture.listening as { items: Record<string, unknown>[] })
      .items;
    items[4].distractorRationales = [
      'CORRECT',
      'fine',
      'closed by REV_014 during remediation',
      'fine',
    ];
    const hits = findProvenanceViolations(fixture);
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toContain('distractorRationales[2]');
  });

  it('detects a token in a rubric anchor description', () => {
    const fixture = clone(rubrics()) as {
      rubrics: { criteria: { anchors: { anchor: string }[] }[] }[];
    };
    fixture.rubrics[0].criteria[0].anchors[0].anchor =
      'No response. See IR-017.';
    expect(findProvenanceViolations(fixture).length).toBeGreaterThan(0);
  });

  it('does not flag legitimate content that merely resembles an identifier', () => {
    const benign = {
      difficultyTier: 'D1',
      tierRange: 'D1-D3',
      review: 'A reviewer should check this item',
      revision: 'Putting the notes away and revising is harder',
      step: 'Follow the steps in order',
      prompt: 'The session starts at half past nine',
      scaleId: 'BREADTRANS_AUTHORING_DIFFICULTY_D1_D4',
    };
    expect(findProvenanceViolations(benign)).toEqual([]);
  });
});

describe('active CEFR guard', () => {
  it('passes the real content draft, rubrics and blueprint', () => {
    expect(findActiveCefrViolations(draft())).toEqual([]);
    expect(findActiveCefrViolations(rubrics())).toEqual([]);
    // The blueprint legitimately discusses CEFR in its rationale; none of it
    // may be acting as a level.
    expect(findActiveCefrViolations(blueprint())).toEqual([]);
  });

  it('detects a CEFR code used as a result band in the blueprint', () => {
    const fixture = clone(blueprint()) as Record<string, unknown>;
    fixture.levelSystem = { bands: [{ band: 'B2', min: 80, max: 100 }] };
    const hits = findActiveCefrViolations(fixture);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.token.toUpperCase() === 'B2')).toBe(true);
  });

  it('detects a CEFR code used as an item difficulty in the blueprint', () => {
    const fixture = clone(blueprint()) as {
      difficultyScale: { tiers: Record<string, unknown>[] };
    };
    fixture.difficultyScale.tiers[0].cefrEquivalent = 'A1';
    expect(findActiveCefrViolations(fixture).length).toBeGreaterThan(0);
  });

  it('detects a CEFR code used as an item level in the content draft', () => {
    const fixture = clone(draft()) as Record<string, unknown>;
    const items = (fixture.listening as { items: Record<string, unknown>[] })
      .items;
    items[0].intendedLevel = 'A2';
    expect(findActiveCefrViolations(fixture).length).toBeGreaterThan(0);
  });

  it('detects a CEFR token inside a level-bearing field even in prose', () => {
    const fixture = { resultBandNote: 'roughly CEFR B1 equivalent' };
    expect(findActiveCefrViolations(fixture).length).toBeGreaterThan(0);
  });

  it('does NOT flag historical design rationale that mentions CEFR', () => {
    const historical = {
      cefrClaimBasis:
        'BreadTrans does not yet have sufficient evidence for a CEFR-linked claim.',
      notCefr: 'D1-D4 are NOT CEFR levels and were not derived from A2/B1/B2.',
      previousDraftDifficultyNote:
        'previous draft recorded "A2-B1"; retained only to show the progression',
      notAnExamination: 'No CEFR, ALTE or exam-equivalence claim.',
    };
    expect(findActiveCefrViolations(historical)).toEqual([]);
  });
});

describe('database-id guard', () => {
  it('passes the real content draft and rubrics', () => {
    expect(findDatabaseIds(draft())).toEqual([]);
    expect(findDatabaseIds(rubrics())).toEqual([]);
  });

  it('detects a top-level numeric id', () => {
    const fixture = clone(draft()) as Record<string, unknown>;
    fixture.id = 2;
    const hits = findDatabaseIds(fixture);
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe('id');
  });

  it('detects a nested numeric id on an item', () => {
    const fixture = clone(draft()) as Record<string, unknown>;
    const items = (fixture.listening as { items: Record<string, unknown>[] })
      .items;
    items[2].id = 417;
    items[2].assessmentId = 2;
    const hits = findDatabaseIds(fixture);
    expect(hits.map((h) => h.path).sort()).toEqual([
      'listening.items[2].assessmentId',
      'listening.items[2].id',
    ]);
  });

  it('detects a numeric id deep inside a rubric criterion', () => {
    const fixture = clone(rubrics()) as {
      rubrics: { criteria: Record<string, unknown>[] }[];
    };
    fixture.rubrics[1].criteria[0].rubricId = 9;
    expect(findDatabaseIds(fixture)).toHaveLength(1);
  });

  it('does not reject legitimate numeric fields or string identifiers', () => {
    const benign = {
      order: 3,
      estimatedSeconds: 25,
      wordMin: 60,
      wordMax: 90,
      prepSeconds: 15,
      responseSeconds: 45,
      wordCount: 151,
      contentVersion: 5,
      schemaVersion: 1,
      scoreMin: 0,
      scoreMax: 4,
      draftKey: 'LST_Q_001',
      mediaDraftKey: 'LST_CLIP_01',
      passageDraftKey: 'RDG_PASSAGE_02',
      scaleId: 'BREADTRANS_AUTHORING_DIFFICULTY_D1_D4',
    };
    expect(findDatabaseIds(benign)).toEqual([]);
  });

  it('is reachable at all — the previous check could not fail', () => {
    // The old implementation ran /\bid\b":\s*\d/ over an array of draft-key
    // strings, which can never contain an object property. Proving the new one
    // fires on the simplest possible positive case.
    expect(findDatabaseIds({ id: 1 })).toHaveLength(1);
  });
});
