import {
  attemptTimeSummary,
  canContinueSession,
  sectionCutoff,
  sessionDeadline,
  timedSections,
} from './toeic-assessment-session';

const startedAt = new Date('2026-11-02T10:00:00Z');
const speaking = (status: string) => ({
  status,
  startedAt: status === 'NOT_STARTED' ? null : startedAt,
  assessmentComponent: { kind: 'SPEAKING' },
});
const writing = (status: string, opened = startedAt) => ({
  status,
  startedAt: status === 'NOT_STARTED' ? null : opened,
  assessmentComponent: { kind: 'WRITING' },
});
const listening = (
  status: string,
  childStatus: string,
  deadline: Date | null,
) => ({
  status,
  startedAt,
  assessmentComponent: { kind: 'LISTENING_READING' },
  toeicAttempt: { status: childStatus, deadline },
});

describe('continuing an unfinished session', () => {
  it('runs 20 minutes on Speaking and 60 on Writing, 80 in all', () => {
    expect(sessionDeadline([speaking('IN_PROGRESS')])).toEqual(
      new Date('2026-11-02T10:20:00Z'),
    );
    expect(
      sessionDeadline([speaking('COMPLETED'), writing('IN_PROGRESS')]),
    ).toEqual(new Date('2026-11-02T11:00:00Z'));
  });

  it('allows going back while the section still has time', () => {
    const now = new Date('2026-11-02T10:19:59Z');
    expect(canContinueSession([speaking('IN_PROGRESS')], now)).toBe(true);
  });

  it('refuses a session whose section ran out', () => {
    const now = new Date('2026-11-02T10:20:00Z');
    expect(canContinueSession([speaking('IN_PROGRESS')], now)).toBe(false);
  });

  it('reads the clock of the running paper in a 4 Skills exam', () => {
    const deadline = new Date('2026-11-02T12:00:00Z');
    const sections = [
      listening('IN_PROGRESS', 'IN_PROGRESS', deadline),
      speaking('NOT_STARTED'),
    ];
    expect(sessionDeadline(sections)).toEqual(deadline);
    expect(canContinueSession(sections, new Date('2026-11-02T12:00:01Z'))).toBe(
      false,
    );
  });

  it('keeps a session between two sections, where no clock runs', () => {
    const sections = [speaking('COMPLETED'), writing('NOT_STARTED')];
    expect(sessionDeadline(sections)).toBeNull();
    expect(canContinueSession(sections, new Date('2027-01-01'))).toBe(true);
  });

  it('keeps a paper that is in and only has to be closed', () => {
    const sections = [
      listening('IN_PROGRESS', 'SUBMITTED', new Date('2026-11-02T10:00:00Z')),
    ];
    expect(sessionDeadline(sections)).toBeNull();
  });
});

describe('the whole-exam clock', () => {
  const lr = (
    status: string,
    durationSeconds: number,
    deadline: Date | null,
  ) => ({
    status,
    startedAt,
    assessmentComponent: { kind: 'LISTENING_READING' },
    toeicAttempt: { status: 'IN_PROGRESS', deadline, durationSeconds },
  });

  it('gives a Speaking & Writing exam 80 minutes in all before it starts', () => {
    const summary = attemptTimeSummary(
      timedSections([speaking('NOT_STARTED'), writing('NOT_STARTED')]),
      startedAt,
    );
    expect(summary).toEqual({
      totalLimitSeconds: 4800,
      totalRemainingSeconds: 4800,
    });
  });

  it('gives a 4-skill exam 200 minutes: L&R 120, Speaking 20, Writing 60', () => {
    const now = new Date('2026-11-02T10:30:00Z');
    const summary = attemptTimeSummary(
      timedSections([
        lr('IN_PROGRESS', 7200, new Date('2026-11-02T12:00:00Z')),
        speaking('NOT_STARTED'),
        writing('NOT_STARTED'),
      ]),
      now,
    );
    expect(summary.totalLimitSeconds).toBe(12000);
    // 90 minutes left of L&R, then the full 80 of Speaking and Writing.
    expect(summary.totalRemainingSeconds).toBe(90 * 60 + 4800);
  });

  it('counts nothing for a finished section and never below zero', () => {
    const now = new Date('2026-11-02T13:00:00Z');
    const summary = attemptTimeSummary(
      timedSections([speaking('COMPLETED'), writing('IN_PROGRESS')]),
      now,
    );
    expect(summary.totalRemainingSeconds).toBe(0);
  });

  it('lets answers count 30 seconds past a timed section only', () => {
    expect(sectionCutoff('SPEAKING', startedAt)).toEqual(
      new Date('2026-11-02T10:20:30Z'),
    );
    expect(sectionCutoff('LISTENING_READING', startedAt)).toBeNull();
    expect(sectionCutoff('WRITING', null)).toBeNull();
  });
});
