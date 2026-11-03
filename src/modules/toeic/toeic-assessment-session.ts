/**
 * Start always opens a new session and leaves an unfinished one in place, so
 * the learner can go back to it from inside the exam. These rules decide when
 * that is still possible. No Prisma client here, so they test without a database.
 */

/**
 * One clock per section, as on the Speaking and Writing tests. Listening &
 * Reading keeps its own deadline on the child attempt.
 */
export const COMPONENT_SECONDS: Partial<Record<string, number>> = {
  SPEAKING: 20 * 60,
  WRITING: 60 * 60,
};

type SessionSection = {
  status: string;
  startedAt: Date | null;
  assessmentComponent: { kind: string };
  toeicAttempt?: { status: string; deadline: Date | null } | null;
};

/** The section the session stopped in: the first one not yet completed. */
export function openSection<T extends { status: string }>(sections: T[]) {
  return sections.find((section) => section.status !== 'COMPLETED') ?? null;
}

/**
 * When the session's running section runs out, or null while no clock runs:
 * a section not opened yet, or a paper that only has to be closed.
 */
export function sessionDeadline(sections: SessionSection[]): Date | null {
  const section = openSection(sections);
  if (!section || section.status === 'NOT_STARTED') return null;
  if (section.assessmentComponent.kind === 'LISTENING_READING') {
    const child = section.toeicAttempt;
    return child?.status === 'IN_PROGRESS' ? child.deadline : null;
  }
  const seconds = COMPONENT_SECONDS[section.assessmentComponent.kind];
  return seconds && section.startedAt
    ? new Date(section.startedAt.getTime() + seconds * 1000)
    : null;
}

/** Listening & Reading when neither the child attempt nor its source says otherwise. */
export const LR_DEFAULT_SECONDS = 120 * 60;

/** Late answers of a Speaking or Writing section still count within this margin. */
export const SECTION_GRACE_SECONDS = 30;

/** The time limit of one section; L&R takes the duration of its paper. */
export function sectionLimitSeconds(
  kind: string,
  lrSeconds?: number | null,
): number {
  if (kind === 'LISTENING_READING') return lrSeconds ?? LR_DEFAULT_SECONDS;
  return COMPONENT_SECONDS[kind] ?? 0;
}

/**
 * The last moment a Speaking or Writing answer counts for a section opened at
 * `startedAt`, or null for a section without its own clock.
 */
export function sectionCutoff(
  kind: string,
  startedAt: Date | null,
): Date | null {
  const seconds = COMPONENT_SECONDS[kind];
  if (!seconds || !startedAt) return null;
  return new Date(
    startedAt.getTime() + (seconds + SECTION_GRACE_SECONDS) * 1000,
  );
}

export type TimedSection = {
  status: string;
  limitSeconds: number;
  /** When the running section's clock ends; null before it starts. */
  deadlineAt: Date | null;
};

/**
 * Time of the whole exam: S&W is 20 + 60 = 80 minutes, the 4-skill exam
 * 120 + 20 + 60 = 200. Each section keeps its own limit; what is left is the
 * running section's clock plus the full limit of every section not yet opened.
 */
export function attemptTimeSummary(sections: TimedSection[], now: Date) {
  let totalLimitSeconds = 0;
  let totalRemainingSeconds = 0;
  for (const section of sections) {
    totalLimitSeconds += section.limitSeconds;
    if (section.status === 'COMPLETED') continue;
    totalRemainingSeconds += section.deadlineAt
      ? Math.max(
          0,
          Math.ceil((section.deadlineAt.getTime() - now.getTime()) / 1000),
        )
      : section.limitSeconds;
  }
  return { totalLimitSeconds, totalRemainingSeconds };
}

/** Database rows of an attempt's sections as timed sections. */
export function timedSections(
  sections: Array<
    SessionSection & {
      toeicAttempt?: {
        status: string;
        deadline: Date | null;
        durationSeconds?: number | null;
      } | null;
    }
  >,
  lrSourceSeconds?: number | null,
): TimedSection[] {
  return sections.map((section) => {
    const kind = section.assessmentComponent.kind;
    if (kind === 'LISTENING_READING') {
      const child = section.toeicAttempt;
      return {
        status: section.status,
        limitSeconds: sectionLimitSeconds(
          kind,
          child?.durationSeconds ?? lrSourceSeconds,
        ),
        deadlineAt: child?.deadline ?? null,
      };
    }
    const limitSeconds = sectionLimitSeconds(kind);
    return {
      status: section.status,
      limitSeconds,
      deadlineAt: section.startedAt
        ? new Date(section.startedAt.getTime() + limitSeconds * 1000)
        : null,
    };
  });
}

/** A session past its deadline has no time left to continue in. */
export function canContinueSession(
  sections: SessionSection[],
  now: Date,
): boolean {
  const deadline = sessionDeadline(sections);
  return !deadline || deadline.getTime() > now.getTime();
}
