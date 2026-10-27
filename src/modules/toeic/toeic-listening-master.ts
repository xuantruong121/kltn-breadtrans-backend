/**
 * Continuous Listening recordings ("masters") for TOEIC L&R exam sets.
 *
 * A master is one MP3 built offline by scripts/toeic-listening-master.ts from
 * the exam's approved group clips plus original BreadTrans narration, with a
 * timeline of where each group starts and ends. It is used only by flexible
 * PRACTICE attempts (play, pause, seek, replay); strict FULL_TEST attempts
 * keep the server-enforced one-pass group audio.
 *
 * A master is offered only while its timeline still matches the exam's
 * current Listening groups in order; any content change makes it stale and
 * the learner falls back to per-group audio.
 */
import { EXAM_1_LISTENING_MASTER } from './listening-master/exam-1';

export type ListeningMasterSegment = {
  kind: 'INTRO' | 'DIRECTIONS' | 'GROUP' | 'END';
  part?: number;
  groupId?: number;
  questionNumbers?: number[];
  start: number;
  end: number;
};

export type ListeningMaster = {
  examId: number;
  key: string;
  sha256: string;
  bytes: number;
  durationSeconds: number;
  format: string;
  responseGapSeconds: Record<string, number>;
  timeline: ListeningMasterSegment[];
};

const REGISTRY: Record<number, ListeningMaster> = {
  [EXAM_1_LISTENING_MASTER.examId]: EXAM_1_LISTENING_MASTER,
};

export function listeningMasterFor(examId: number): ListeningMaster | null {
  return REGISTRY[examId] ?? null;
}

/** True when the master's groups are exactly the exam's Listening groups, in order. */
export function masterMatchesGroups(
  master: ListeningMaster,
  orderedGroupIds: number[],
): boolean {
  const masterIds = master.timeline
    .filter((segment) => segment.kind === 'GROUP')
    .map((segment) => segment.groupId);
  return (
    masterIds.length === orderedGroupIds.length &&
    masterIds.every((id, index) => id === orderedGroupIds[index])
  );
}

export function listeningMasterUrl(master: ListeningMaster): string | null {
  const base = (
    process.env.TOEIC_LISTENING_MASTER_BASE_URL ??
    process.env.R2_PUBLIC_URL ??
    ''
  ).replace(/\/$/, '');
  return base ? `${base}/${master.key}` : null;
}
