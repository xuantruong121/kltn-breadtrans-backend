export interface NormalizedDialogueSegment {
  /** Stable learner-facing label retained for transcript rendering. */
  speaker?: string;
  /** Stable participant identifier used by authoring and voice resolution. */
  speakerId?: string;
  /** Stable conversational contribution identifier; several chunks may share it. */
  speakerTurnId?: string;
  /** Legacy/content chunk identifier. It remains distinct from speakerTurnId. */
  turnId?: string;
  text: string;
  translation?: string;
  startMs?: number;
  endMs?: number;
  dialogueAct?: string;
  delivery?: string;
  voiceKey?: string;
  tone?: string;
  rate?: string;
  pauseMs?: number;
  emphasis?: Array<{
    token: string;
    level: 'reduced' | 'moderate' | 'strong';
  }>;
}

function textField(
  raw: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = raw[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function emphasisField(
  raw: Record<string, unknown>,
): NormalizedDialogueSegment['emphasis'] {
  if (!Array.isArray(raw.emphasis)) return undefined;
  const allowed = new Set(['reduced', 'moderate', 'strong'] as const);
  const values = raw.emphasis.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const token = textField(item, 'token');
    const level = textField(item, 'level') as
      'reduced' | 'moderate' | 'strong' | undefined;
    if (!token || !level || !allowed.has(level)) return [];
    return [{ token, level }];
  });
  return values.length ? values : undefined;
}

/**
 * Normalize the JSON contract at the boundary. Legacy flat segments continue
 * to work; V2 metadata is carried through without making it required in Prisma.
 */
export function normalizeDialogueSegments(
  value: unknown,
): NormalizedDialogueSegment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const text = textField(raw, 'text');
    const speaker = textField(raw, 'speaker');
    const speakerId = textField(raw, 'speakerId');
    if (!text || (!speaker && !speakerId)) return [];
    const pauseMs =
      typeof raw.pauseMs === 'number' && Number.isFinite(raw.pauseMs)
        ? Math.min(800, Math.max(100, Math.round(raw.pauseMs)))
        : undefined;
    const emphasis = emphasisField(raw);
    return [
      {
        ...(speaker ? { speaker } : {}),
        ...(speakerId ? { speakerId } : {}),
        ...(textField(raw, 'speakerTurnId')
          ? { speakerTurnId: textField(raw, 'speakerTurnId') }
          : {}),
        ...(textField(raw, 'turnId')
          ? { turnId: textField(raw, 'turnId') }
          : {}),
        text,
        ...(textField(raw, 'translation')
          ? { translation: textField(raw, 'translation') }
          : {}),
        ...(Number.isFinite(raw.startMs)
          ? { startMs: Number(raw.startMs) }
          : {}),
        ...(Number.isFinite(raw.endMs) ? { endMs: Number(raw.endMs) } : {}),
        ...(textField(raw, 'dialogueAct')
          ? { dialogueAct: textField(raw, 'dialogueAct') }
          : {}),
        ...(textField(raw, 'delivery')
          ? { delivery: textField(raw, 'delivery') }
          : {}),
        ...(textField(raw, 'voiceKey')
          ? { voiceKey: textField(raw, 'voiceKey') }
          : {}),
        ...(textField(raw, 'tone') ? { tone: textField(raw, 'tone') } : {}),
        ...(textField(raw, 'rate') ? { rate: textField(raw, 'rate') } : {}),
        ...(pauseMs !== undefined ? { pauseMs } : {}),
        ...(emphasis ? { emphasis } : {}),
      } satisfies NormalizedDialogueSegment,
    ];
  });
}

/**
 * Assign deterministic speaker-turn IDs to legacy content. Consecutive chunks
 * by one participant form one contribution; explicit IDs always win.
 */
export function withSpeakerTurnIds(
  segments: NormalizedDialogueSegment[],
): NormalizedDialogueSegment[] {
  let generated = 0;
  let previousSpeaker = '';
  let currentId = '';
  return segments.map((segment) => {
    const speaker = segment.speakerId ?? segment.speaker ?? 'speaker-1';
    if (!segment.speakerTurnId && speaker !== previousSpeaker) {
      generated += 1;
      currentId = `speaker-turn-${String(generated).padStart(3, '0')}`;
    }
    previousSpeaker = speaker;
    return {
      ...segment,
      speakerTurnId: segment.speakerTurnId ?? currentId,
    };
  });
}
