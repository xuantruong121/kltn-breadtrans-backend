import {
  EXPLANATION_SCHEMA,
  PART1_VISION_SCHEMA,
  SOLVE_SCHEMA,
} from '../toeic-answer-review-prompt';
import { strictJsonSchema } from './strict-json-schema';

/** Every object node of a schema, with the path that reaches it. */
function objects(node: any, path = '$'): Array<{ path: string; node: any }> {
  if (!node || typeof node !== 'object') return [];
  const found = node.type === 'object' ? [{ path, node }] : [];
  for (const [key, value] of Object.entries(node))
    found.push(...objects(value, `${path}.${key}`));
  return found;
}

describe('strictJsonSchema', () => {
  it.each([
    ['solve', SOLVE_SCHEMA],
    ['explanation', EXPLANATION_SCHEMA],
    ['part 1 vision', PART1_VISION_SCHEMA],
  ])(
    '%s: every object forbids extra keys and requires every property',
    (_, schema) => {
      const strict = strictJsonSchema(schema);
      const nodes = objects(strict);
      expect(nodes.length).toBeGreaterThan(0);
      for (const { path, node } of nodes) {
        expect({ path, extra: node.additionalProperties }).toEqual({
          path,
          extra: false,
        });
        expect({ path, required: [...node.required].sort() }).toEqual({
          path,
          required: Object.keys(node.properties).sort(),
        });
      }
    },
  );

  it('leaves the original schema unchanged for Gemini', () => {
    const before = JSON.stringify(SOLVE_SCHEMA);
    strictJsonSchema(SOLVE_SCHEMA);
    expect(JSON.stringify(SOLVE_SCHEMA)).toBe(before);
    expect(JSON.stringify(SOLVE_SCHEMA)).not.toContain('additionalProperties');
  });
});
