/**
 * Guards added in Phase B1, both found by the isolated rehearsal rather than by
 * reading the code. Each has at least one fixture that genuinely fails without
 * the guard, so the suite would catch a regression rather than only confirming
 * the happy path.
 */
import { assertUniqueSourceKeys } from './v2-content-importer';
import { GENERIC_PASSAGE_TITLE, titledPassage } from './v2-import-mapper';

const draft = () => ({
  blueprintVersion: 'V2_2026_01',
  scoringVersion: 'FOUR_SKILL_PLACEMENT_V2',
  contentVersion: 6,
  listening: {
    clips: [{ draftKey: 'LST_C_01' }, { draftKey: 'LST_C_02' }],
    items: [{ draftKey: 'LST_Q_001' }, { draftKey: 'LST_Q_002' }],
  },
  reading: {
    passages: [{ draftKey: 'RDG_P_01' }, { draftKey: 'RDG_P_02' }],
    items: [{ draftKey: 'RDG_Q_001' }],
  },
  speaking: { tasks: [{ draftKey: 'SPK_TASK_01' }] },
  writing: { tasks: [{ draftKey: 'WRT_TASK_01' }] },
  languageUse: { items: [{ draftKey: 'LU_Q_001' }] },
});
const rubrics = () => ({
  rubrics: [
    { skill: 'SPEAKING', rubricVersion: 'spk-v1' },
    { skill: 'WRITING', rubricVersion: 'wrt-v1' },
  ],
});

describe('assertUniqueSourceKeys', () => {
  it('accepts the shape the approved content actually has', () => {
    expect(() =>
      assertUniqueSourceKeys(draft() as any, rubrics()),
    ).not.toThrow();
  });

  // The reason this guard exists: two items sharing a draftKey both upsert onto
  // the SAME row, so the second silently overwrites the first's content while
  // the row count stays correct. Counting rows cannot detect it.
  it('refuses a duplicate question draftKey across different sections', () => {
    const d = draft();
    d.languageUse.items[0].draftKey = 'LST_Q_001';
    expect(() => assertUniqueSourceKeys(d as any, rubrics())).toThrow(
      /duplicate question draftKey "LST_Q_001"/,
    );
  });

  it('refuses a duplicate question draftKey within one section', () => {
    const d = draft();
    d.listening.items[1].draftKey = 'LST_Q_001';
    expect(() => assertUniqueSourceKeys(d as any, rubrics())).toThrow(
      /duplicate question draftKey/,
    );
  });

  it('refuses a duplicate draftKey shared between a task and an item', () => {
    const d = draft();
    d.writing.tasks[0].draftKey = 'SPK_TASK_01';
    expect(() => assertUniqueSourceKeys(d as any, rubrics())).toThrow(
      /duplicate question draftKey "SPK_TASK_01"/,
    );
  });

  it('refuses a duplicate passage draftKey', () => {
    const d = draft();
    d.reading.passages[1].draftKey = 'RDG_P_01';
    expect(() => assertUniqueSourceKeys(d as any, rubrics())).toThrow(
      /duplicate passage draftKey "RDG_P_01"/,
    );
  });

  it('refuses a duplicate clip draftKey', () => {
    const d = draft();
    d.listening.clips[1].draftKey = 'LST_C_01';
    expect(() => assertUniqueSourceKeys(d as any, rubrics())).toThrow(
      /duplicate clip draftKey "LST_C_01"/,
    );
  });

  it('refuses two rubrics with the same skill and version', () => {
    const r = rubrics();
    r.rubrics[1] = { skill: 'SPEAKING', rubricVersion: 'spk-v1' };
    expect(() => assertUniqueSourceKeys(draft() as any, r)).toThrow(
      /duplicate rubric identity "SPEAKING@spk-v1"/,
    );
  });

  it('allows the same rubric version under two different skills', () => {
    const r = rubrics();
    r.rubrics[1] = { skill: 'WRITING', rubricVersion: 'spk-v1' };
    expect(() => assertUniqueSourceKeys(draft() as any, r)).not.toThrow();
  });

  it.each([undefined, null, ''])('refuses a missing identity (%p)', (bad) => {
    const d = draft();
    (d.reading.items[0] as any).draftKey = bad;
    expect(() => assertUniqueSourceKeys(d as any, rubrics())).toThrow(
      /has no question draftKey/,
    );
  });
});

describe('titledPassage', () => {
  // sanitizeQuestion reads line 1 of passageText as the title and serves only
  // the remaining lines as the body. Measured in B1 before this fix: 7 of 10
  // Reading items lost their opening paragraph, 405 characters in total.
  const split = (stored: string) => {
    const lines = stored.split('\n');
    return lines.length > 1
      ? { title: lines[0].trim(), body: lines.slice(1).join('\n').trim() }
      : { title: GENERIC_PASSAGE_TITLE, body: stored };
  };

  it('keeps a multi-paragraph body complete after the serializer split', () => {
    const authored =
      'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const { title, body } = split(titledPassage(authored));
    expect(title).toBe(GENERIC_PASSAGE_TITLE);
    expect(body).toBe(authored);
  });

  it('shows the defect it guards against: an untitled passage loses line 1', () => {
    const authored = 'First paragraph.\n\nSecond paragraph.';
    const { title, body } = split(authored);
    expect(title).toBe('First paragraph.');
    expect(body).not.toContain('First paragraph.');
  });

  it('leaves a single-paragraph passage readable', () => {
    const authored = 'One paragraph only, no newline anywhere.';
    const { title, body } = split(titledPassage(authored));
    expect(title).toBe(GENERIC_PASSAGE_TITLE);
    expect(body).toBe(authored);
  });

  it('is idempotent, so a re-import does not stack title lines', () => {
    const authored = 'First paragraph.\n\nSecond paragraph.';
    const once = titledPassage(authored);
    expect(titledPassage(once)).toBe(once);
    expect(titledPassage(titledPassage(once))).toBe(once);
  });

  it('does not introduce any text beyond the heading the serializer already uses', () => {
    const authored = 'Body text.';
    expect(
      titledPassage(authored).replace(GENERIC_PASSAGE_TITLE, '').trim(),
    ).toBe(authored);
  });
});
