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

/** A session past its deadline has no time left to continue in. */
export function canContinueSession(
  sections: SessionSection[],
  now: Date,
): boolean {
  const deadline = sessionDeadline(sections);
  return !deadline || deadline.getTime() > now.getTime();
}
