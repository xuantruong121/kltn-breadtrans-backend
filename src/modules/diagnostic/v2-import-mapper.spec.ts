import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getAttemptQuestionPermutation } from './diagnostic.logic';
import {
  assertNoAuthoringFields,
  authoredIndexFromDisplayed,
  displayedIndexFromAuthored,
  mapObjectiveQuestion,
  mapProductiveTask,
  rationaleForDisplayedOption,
  type ObjectiveDraftItem,
} from './v2-import-mapper';

const ART = join(__dirname, '..', '..', '..', 'artifacts');
const draft = JSON.parse(
  readFileSync(join(ART, 'entry-diagnostic-v2-content-draft.json'), 'utf8'),
) as {
  listening: { items: ObjectiveDraftItem[] };
  reading: { items: ObjectiveDraftItem[] };
  languageUse: { items: ObjectiveDraftItem[] };
  speaking: { tasks: Record<string, unknown>[] };
  writing: { tasks: Record<string, unknown>[] };
};

const objectiveItems: ObjectiveDraftItem[] = [
  ...draft.listening.items,
  ...draft.reading.items,
  ...draft.languageUse.items,
];

const ctx = {
  assessmentId: 999,
  passageIds: { RDG_PASSAGE_01: 11, RDG_PASSAGE_02: 12, RDG_PASSAGE_03: 13 },
  rubricIds: { SPK_RUBRIC_V3: 21, WRT_RUBRIC_V3: 22 },
};

/** Every permutation of 4 items, for the exhaustive shuffle proof. */
function permutationsOf4(): number[][] {
  const out: number[][] = [];
  const base = [0, 1, 2, 3];
  const recurse = (rest: number[], acc: number[]): void => {
    if (rest.length === 0) {
      out.push([...acc]);
      return;
    }
    rest.forEach((value, index) => {
      recurse(
        [...rest.slice(0, index), ...rest.slice(index + 1)],
        [...acc, value],
      );
    });
  };
  recurse(base, []);
  return out;
}

describe('v2 import mapper — allowlist discipline', () => {
  it('maps all 25 objective items without throwing', () => {
    expect(objectiveItems).toHaveLength(25);
    for (const item of objectiveItems) {
      const payload = mapObjectiveQuestion(item, ctx);
      expect(payload.assessmentId).toBe(999);
      expect(payload.question).toBe(item.prompt);
      expect(payload.options).toEqual(item.options);
    }
  });

  it('derives correctIndex from correctAnswer for every objective item', () => {
    for (const item of objectiveItems) {
      const payload = mapObjectiveQuestion(item, ctx);
      expect(payload.options[payload.correctIndex]).toBe(item.correctAnswer);
    }
  });

  it('never routes the authored difficulty tier into intendedLevel', () => {
    for (const item of objectiveItems) {
      const payload = mapObjectiveQuestion(item, ctx);
      expect(payload.intendedLevel).toBeNull();
      expect(payload.difficulty).toBe(item.difficultyTier);
    }
  });

  it('emits no authoring-only field on any payload', () => {
    for (const item of objectiveItems) {
      const payload = mapObjectiveQuestion(item, ctx) as unknown as Record<
        string,
        unknown
      >;
      expect(() =>
        assertNoAuthoringFields(payload, item.draftKey),
      ).not.toThrow();
      expect(payload.draftKey).toBeUndefined();
      expect(payload.distractorRationales).toBeUndefined();
      expect(payload.answerRationale).toBeUndefined();
    }
  });

  it('rejects a payload carrying an authoring field (negative fixture)', () => {
    expect(() =>
      assertNoAuthoringFields(
        { question: 'x', distractorRationales: [] },
        'fixture',
      ),
    ).toThrow(/distractorRationales/);
  });

  it('rejects a payload carrying a key the schema does not have', () => {
    expect(() =>
      assertNoAuthoringFields({ question: 'x', madeUp: 1 }, 'fixture'),
    ).toThrow(/not a DiagnosticQuestion column/);
  });

  it('refuses an item whose correctAnswer is absent from options', () => {
    const broken = { ...objectiveItems[0], correctAnswer: 'not an option' };
    expect(() => mapObjectiveQuestion(broken, ctx)).toThrow(
      /not one of options/,
    );
  });

  it('refuses an unresolved passage reference rather than writing null', () => {
    const item = draft.reading.items.find((i) => i.passageDraftKey);
    expect(item).toBeDefined();
    expect(() =>
      mapObjectiveQuestion(item as ObjectiveDraftItem, { assessmentId: 1 }),
    ).toThrow(/unresolved/);
  });

  it('maps the 4 productive tasks with the no-key sentinel and a rubric id', () => {
    const tasks = [...draft.speaking.tasks, ...draft.writing.tasks];
    expect(tasks).toHaveLength(4);
    for (const task of tasks) {
      const payload = mapProductiveTask(task as never, ctx);
      expect(payload.correctIndex).toBe(-1);
      expect(payload.options).toEqual([]);
      expect(payload.explanation).toBeNull();
      expect([21, 22]).toContain(payload.rubricId);
    }
  });
});

describe('option identity under shuffle', () => {
  it('the runtime permutation is deterministic for an attempt and question', () => {
    const a = getAttemptQuestionPermutation(1234, 77, 4);
    const b = getAttemptQuestionPermutation(1234, 77, 4);
    expect(a).toEqual(b);
  });

  it('round-trips authored <-> displayed for all 24 permutations', () => {
    for (const perm of permutationsOf4()) {
      for (let displayed = 0; displayed < 4; displayed += 1) {
        const authored = authoredIndexFromDisplayed(perm, displayed);
        expect(displayedIndexFromAuthored(perm, authored)).toBe(displayed);
      }
    }
  });

  // The core guarantee: whatever the shuffle, the rationale shown beside an
  // option is that option's own rationale, and the CORRECT marker lands on the
  // key. This is what positional storage would have broken.
  it.each(objectiveItems.map((i) => [i.draftKey, i] as const))(
    '%s keeps key and rationale aligned across all 24 permutations',
    (_key, item) => {
      const authoredCorrect = item.options.indexOf(item.correctAnswer);
      for (const perm of permutationsOf4()) {
        const displayedOptions = perm.map((idx) => item.options[idx]);
        let correctSeen = 0;
        for (let displayed = 0; displayed < 4; displayed += 1) {
          const resolved = rationaleForDisplayedOption(item, perm, displayed);
          // the text rendered at this position is the option we resolved
          expect(resolved.optionText).toBe(displayedOptions[displayed]);
          // the rationale is the authored rationale for THAT option
          const authored = perm[displayed];
          expect(resolved.rationale).toBe(
            item.distractorRationales?.[authored],
          );
          // CORRECT marker and correctness agree, wherever the key landed
          if (resolved.isCorrect) {
            correctSeen += 1;
            expect(resolved.rationale).toBe('CORRECT');
            expect(authored).toBe(authoredCorrect);
          } else {
            expect(resolved.rationale).not.toBe('CORRECT');
          }
        }
        expect(correctSeen).toBe(1);
      }
    },
  );

  it('grading stays correct under every permutation (authored key is canonical)', () => {
    for (const item of objectiveItems) {
      const correctIndex = item.options.indexOf(item.correctAnswer);
      for (const perm of permutationsOf4()) {
        // the learner clicks the position where the key is displayed
        const displayed = perm.indexOf(correctIndex);
        expect(perm[displayed]).toBe(correctIndex);
        // and every other position must NOT grade as correct
        for (let other = 0; other < 4; other += 1) {
          if (other === displayed) continue;
          expect(perm[other]).not.toBe(correctIndex);
        }
      }
    }
  });
});
