/**
 * Saving a Listening question from the CMS form must not drop what the form
 * does not show. Published questions carry accent, level, skill, image,
 * explanation evidence and per-speaker voiceKey; the form sends only the
 * fields it edits, and the update used to replace the whole content (found
 * 2026-10-30: editing a question erased its transcript metadata and would
 * break the quiz audio). Pure: no I/O.
 */
type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export function mergeListeningContent(existing: unknown, incoming: Json): Json {
  const before = isObject(existing) ? existing : {};
  const defined = Object.fromEntries(
    Object.entries(incoming).filter(([, v]) => v !== undefined),
  );
  const merged: Json = { ...before, ...defined };

  // The form edits the Vietnamese text of a structured explanation.
  if (typeof defined.explanation === 'string' && isObject(before.explanation))
    merged.explanation = { ...before.explanation, vi: defined.explanation };
  // A bilingual edit ({ vi, en }) keeps the stored evidence and notes.
  if (isObject(defined.explanation) && isObject(before.explanation))
    merged.explanation = { ...before.explanation, ...defined.explanation };

  // Keep each speaker's voice and ids the form does not show.
  if (
    Array.isArray(defined.transcriptSegments) &&
    Array.isArray(before.transcriptSegments)
  ) {
    const old = before.transcriptSegments.filter(isObject);
    merged.transcriptSegments = defined.transcriptSegments.map((segment, i) => {
      if (!isObject(segment)) return segment;
      const same =
        (isObject(old[i]) && old[i].speaker === segment.speaker
          ? old[i]
          : undefined) ?? old.find((o) => o.speaker === segment.speaker);
      if (!same) return segment;
      const carried = Object.fromEntries(
        [
          'voiceKey',
          'speakerId',
          'delivery',
          'tone',
          'rate',
          'pauseMs',
        ].flatMap((k) => (same[k] !== undefined ? [[k, same[k]]] : [])),
      );
      return { ...carried, ...segment };
    });
  }
  return merged;
}

/** What a question's own clip reads aloud: its statement, answer sentence and turns. */
function spokenText(content: unknown): string {
  const c = (content ?? {}) as Record<string, unknown>;
  const turns = Array.isArray(c.transcriptSegments)
    ? c.transcriptSegments.map((turn) => {
        const t = (turn ?? {}) as Record<string, unknown>;
        return [t.speaker ?? t.speakerId ?? '', t.text ?? ''];
      })
    : [];
  return JSON.stringify([c.audioText ?? '', c.correctAnswer ?? '', turns]);
}

/** True when an edit changes what the question's clip says, so that clip no longer matches. */
export function spokenTextChanged(before: unknown, after: unknown): boolean {
  return spokenText(before) !== spokenText(after);
}
