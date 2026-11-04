/**
 * Strict structured output (Groq and other OpenAI-compatible servers) needs
 * every object to forbid extra keys, and every property to be required. The
 * review schemas already list every property in `required`; this adds
 * `additionalProperties: false` to each object without touching the original,
 * which Gemini receives as is (its schema format has no such key).
 */
export function strictJsonSchema<T>(schema: T): T {
  if (Array.isArray(schema))
    return schema.map((item) => strictJsonSchema(item)) as T;
  if (!schema || typeof schema !== 'object') return schema;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>))
    copy[key] = strictJsonSchema(value);
  if (copy.type === 'object') copy.additionalProperties = false;
  return copy as T;
}
